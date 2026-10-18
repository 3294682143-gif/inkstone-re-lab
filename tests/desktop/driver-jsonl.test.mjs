import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JsonlFramer, parseRequestLine, parseMessage, encodeRequest, DriverCorrelator, DriverProtocolError } from '../../src/desktop/driver-jsonl.mjs';

const SESSION = readFileSync(new URL('../../fixtures/desktop/driver-session.synthetic.jsonl', import.meta.url), 'utf8');

test('JSONL 分帧：任意分块 + 跨字节', () => {
  const f = new JsonlFramer(); const lines = []; const buf = Buffer.from(SESSION, 'utf8');
  for (let i = 0; i < buf.length; i += 3) lines.push(...f.push(buf.subarray(i, i + 3)));
  lines.push(...f.flush());
  assert.equal(lines.length, 5);
  assert.equal(JSON.parse(lines[0]).method, 'driver.ready');
});

test('请求仅接受 id/method/params（禁止额外 jsonrpc 字段）', () => {
  assert.deepEqual(parseRequestLine('{"id":"a","method":"models.list","params":{}}'), { id: 'a', method: 'models.list', params: {} });
  assert.throws(() => parseRequestLine('{"id":"a","method":"m","params":{},"jsonrpc":"2.0"}'), DriverProtocolError);
  assert.throws(() => parseRequestLine('{"method":"m"}'), DriverProtocolError);
  assert.throws(() => parseRequestLine('not json'), /valid JSON/);
});

test('encodeRequest 不追加 jsonrpc', () => {
  const line = encodeRequest({ id: 'x', method: 'projects.list', params: {} });
  assert.deepEqual(Object.keys(JSON.parse(line)), ['id', 'method', 'params']);
});

test('响应 / 通知分类', () => {
  assert.equal(parseMessage('{"id":"a","ok":true,"result":{}}').kind, 'response');
  assert.equal(parseMessage('{"id":"a","ok":false,"error":{"code":"E"}}').kind, 'response');
  assert.equal(parseMessage('{"method":"driver.ready","params":{}}').kind, 'notification');
});

// —— 真实请求生命周期 ——
const acceptedLine = (jsonlId, requestId, sessionRef = 'sess_a') => JSON.stringify({ id: jsonlId, ok: true, result: { accepted: true, session_ref: sessionRef, request_id: requestId } });
const completedLine = (requestId, status, sessionRef = 'sess_a', turnId = 'turn_a') => JSON.stringify({ method: 'turn.completed', params: { session_ref: sessionRef, request_id: requestId, turn_id: turnId, status, answer: 'OK', model_ref: 'm' } });
const sendReq = (c, sessionRef = 'sess_a') => c.request('turn.send', { session_ref: sessionRef, query: 'x' });

test('正常请求 → accepted → 成功终态', () => {
  const c = new DriverCorrelator();
  c.handleLine('{"method":"driver.ready","params":{"protocol_version":"inkstone-headless-chat/v1"}}');
  const r = sendReq(c);
  const resp = c.handleLine(acceptedLine(r.id, 'req_1'));
  assert.equal(resp.correlated, true);
  assert.equal(DriverCorrelator.isAccepted(resp), true);
  assert.equal(c.turnOutcome('req_1'), 'pending');
  c.handleLine(completedLine('req_1', 'complete'));
  assert.equal(c.turnOutcome('req_1'), 'completed');
  assert.equal(c.isTerminal('req_1'), true);
  assert.equal(c.isReady(), true);
});

test('accepted 后尚无终态 → pending', () => {
  const c = new DriverCorrelator();
  const r = sendReq(c); c.handleLine(acceptedLine(r.id, 'req_x'));
  assert.equal(c.turnOutcome('req_x'), 'pending');
});

test('失败 / 取消 / 未知 / running 状态', () => {
  for (const [status, expected] of [['stopped', 'stopped'], ['error', 'failed'], ['weird', 'unknown'], [undefined, 'unknown']]) {
    const c = new DriverCorrelator(); const r = sendReq(c); c.handleLine(acceptedLine(r.id, 'req_' + status));
    c.handleLine(completedLine('req_' + status, status));
    assert.equal(c.turnOutcome('req_' + status), expected, `status=${status}`);
  }
  const c2 = new DriverCorrelator(); const r2 = sendReq(c2); c2.handleLine(acceptedLine(r2.id, 'req_run'));
  c2.handleLine(completedLine('req_run', 'running'));
  assert.equal(c2.turnOutcome('req_run'), 'pending');
  const c3 = new DriverCorrelator(); const r3 = sendReq(c3); c3.handleLine(acceptedLine(r3.id, 'req_f'));
  c3.handleLine(JSON.stringify({ method: 'turn.failed', params: { session_ref: 'sess_a', request_id: 'req_f', code: 'E', message: 'boom' } }));
  assert.equal(c3.turnOutcome('req_f'), 'failed');
});

// —— 问题 A：严格关联 ——
test('A1 原始请求与 accepted 的 session_ref 不一致 → 不登记、不算受理', () => {
  const c = new DriverCorrelator();
  const r = sendReq(c, 'session-a');
  const resp = c.handleLine(acceptedLine(r.id, 'req_A1', 'session-b'));
  assert.equal(resp.correlated, false);
  assert.equal(DriverCorrelator.isAccepted(resp), false);
  c.handleLine(completedLine('req_A1', 'complete', 'session-b'));
  assert.equal(c.turnOutcome('req_A1'), 'pending');            // 未被污染
  assert.ok(c.unmatched.some((m) => m.reason === 'session-mismatch'));
});

test('A2 非 turn.send 请求返回 accepted 形状 → 不登记', () => {
  const c = new DriverCorrelator();
  const r = c.request('projects.list', {});
  const resp = c.handleLine(acceptedLine(r.id, 'req_A2'));
  assert.equal(resp.correlated, false);
  assert.equal(DriverCorrelator.isAccepted(resp), false);
  assert.equal(c.turnOutcome('req_A2'), 'pending');
  assert.ok(c.unmatched.some((m) => m.reason === 'accepted-from-non-turn-send'));
});

test('A3 缺失/错误类型的标识符 → 不登记', () => {
  const cases = [
    ['{"id":"R","ok":true,"result":{"accepted":true,"request_id":"","session_ref":"sess_a"}}', 'invalid-request-id'],
    ['{"id":"R","ok":true,"result":{"accepted":true,"request_id":"req","session_ref":5}}', 'invalid-session-ref'],
  ];
  for (const [line, reason] of cases) {
    const c = new DriverCorrelator(); const r = sendReq(c);
    const resp = c.handleLine(line.replace('"id":"R"', `"id":"${r.id}"`));
    assert.equal(resp.correlated, false);
    assert.ok(c.unmatched.some((m) => m.reason === reason), reason);
  }
  // 原请求缺 session_ref
  const c2 = new DriverCorrelator(); const r2 = c2.request('turn.send', { query: 'x' });
  const resp2 = c2.handleLine(acceptedLine(r2.id, 'req_A3'));
  assert.equal(resp2.correlated, false);
  assert.ok(c2.unmatched.some((m) => m.reason === 'request-missing-session-ref'));
});

test('A4 重复 request_id → 第二次被拒，首个仍 pending', () => {
  const c = new DriverCorrelator();
  const r1 = sendReq(c); c.handleLine(acceptedLine(r1.id, 'req_dup'));
  const r2 = sendReq(c); const resp2 = c.handleLine(acceptedLine(r2.id, 'req_dup'));
  assert.equal(resp2.correlated, false);
  assert.ok(c.unmatched.some((m) => m.reason === 'duplicate-request-id'));
  assert.equal(c.turnOutcome('req_dup'), 'pending');
  c.handleLine(completedLine('req_dup', 'complete'));
  assert.equal(c.turnOutcome('req_dup'), 'completed');
});

test('A5 冲突 turn_id → 已记录 turn_id 不可被替换', () => {
  const c = new DriverCorrelator(); const r = sendReq(c); c.handleLine(acceptedLine(r.id, 'req_t'));
  c.handleLine(completedLine('req_t', 'complete', 'sess_a', 'turn_first'));
  assert.equal(c.turnInfo('req_t').turnId, 'turn_first');
  c.handleLine(completedLine('req_t', 'error', 'sess_a', 'turn_second'));   // 迟到且冲突
  assert.equal(c.turnInfo('req_t').turnId, 'turn_first');
  assert.equal(c.turnOutcome('req_t'), 'completed');
  // 单独验证冲突判定（非终态时也能拦住不同 turn_id）
  const c2 = new DriverCorrelator(); const r2 = sendReq(c2); c2.handleLine(acceptedLine(r2.id, 'req_t2'));
  c2.handleLine(completedLine('req_t2', 'running', 'sess_a', 'turn_x'));
  c2.handleLine(completedLine('req_t2', 'complete', 'sess_a', 'turn_y'));
  assert.equal(c2.turnInfo('req_t2').turnId, 'turn_x');
  assert.ok(c2.unmatched.some((m) => m.reason === 'turn-id-conflict'));
});

test('A6 未知响应 correlated=false，isAccepted=false', () => {
  const c = new DriverCorrelator();
  const unknown = c.handleLine('{"id":"nope","ok":true,"result":{"accepted":true,"request_id":"r","session_ref":"s"}}');
  assert.equal(unknown.correlated, false);
  assert.equal(DriverCorrelator.isAccepted(unknown), false);
});

test('A7 终态通知缺失 session_ref → 不接受', () => {
  const c = new DriverCorrelator(); const r = sendReq(c); c.handleLine(acceptedLine(r.id, 'req_ns'));
  c.handleLine('{"method":"turn.completed","params":{"request_id":"req_ns","status":"complete"}}');
  assert.equal(c.turnOutcome('req_ns'), 'pending');
  assert.ok(c.unmatched.some((m) => m.reason === 'terminal-without-session-ref'));
});

test('多请求交错互不串扰', () => {
  const c = new DriverCorrelator();
  const a = sendReq(c, 'sess_a'); const b = sendReq(c, 'sess_b');
  c.handleLine(acceptedLine(a.id, 'req_a', 'sess_a'));
  c.handleLine(acceptedLine(b.id, 'req_b', 'sess_b'));
  c.handleLine(completedLine('req_b', 'complete', 'sess_b'));
  assert.equal(c.turnOutcome('req_a'), 'pending');
  assert.equal(c.turnOutcome('req_b'), 'completed');
  c.handleLine(completedLine('req_a', 'error', 'sess_a'));
  assert.equal(c.turnOutcome('req_a'), 'failed');
});

test('终态确定后，迟到的（错误的）关联事件不能覆盖', () => {
  const c = new DriverCorrelator(); const r = sendReq(c); c.handleLine(acceptedLine(r.id, 'req_1'));
  c.handleLine(completedLine('req_1', 'complete'));
  c.handleLine(completedLine('req_1', 'error'));
  assert.equal(c.turnOutcome('req_1'), 'completed');
  assert.ok(c.unmatched.some((m) => m.reason === 'already-terminal'));
});

test('协议允许的乱序：终态通知先于 accepted 到达 → 有界缓存后重放', () => {
  const c = new DriverCorrelator();
  c.handleLine(completedLine('req_early', 'complete'));
  assert.equal(c.orphans.size, 1);
  const r = sendReq(c);
  c.handleLine(acceptedLine(r.id, 'req_early'));
  assert.equal(c.turnOutcome('req_early'), 'completed');
  assert.equal(c.orphans.size, 0);
});

test('孤儿缓存有上限（无主通知不无限增长）', () => {
  const c = new DriverCorrelator({ orphanLimit: 3 });
  for (let i = 0; i < 10; i++) c.handleLine(completedLine('req_' + i, 'complete'));
  assert.ok(c.orphans.size <= 3);
});

test('无 request_id 的终态通知不污染任何回合', () => {
  const c = new DriverCorrelator();
  c.handleLine('{"method":"turn.completed","params":{"session_ref":"s"}}');
  assert.equal(c.turns.size, 0);
  assert.ok(c.unmatched.some((m) => m.reason === 'terminal-without-request-id'));
});
