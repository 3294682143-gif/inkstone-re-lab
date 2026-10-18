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

// —— 真实请求生命周期：先 request() 再喂响应 ——
function acceptedLine(jsonlId, requestId, sessionRef = 'sess_a') {
  return JSON.stringify({ id: jsonlId, ok: true, result: { accepted: true, session_ref: sessionRef, request_id: requestId } });
}
function completedLine(requestId, status, sessionRef = 'sess_a', turnId = 'turn_a') {
  return JSON.stringify({ method: 'turn.completed', params: { session_ref: sessionRef, request_id: requestId, turn_id: turnId, status, answer: 'OK', model_ref: 'm' } });
}

test('正常请求 → accepted → 成功终态', () => {
  const c = new DriverCorrelator();
  c.handleLine('{"method":"driver.ready","params":{"protocol_version":"inkstone-headless-chat/v1"}}');
  const r = c.request('turn.send', { session_ref: 'sess_a', query: 'x' });
  const resp = c.handleLine(acceptedLine(r.id, 'req_1'));
  assert.equal(resp.correlated, true);
  assert.equal(DriverCorrelator.isAccepted(resp), true);       // 只是“已受理”
  assert.equal(c.turnOutcome('req_1'), 'pending');             // 尚未终态
  c.handleLine(completedLine('req_1', 'complete'));
  assert.equal(c.turnOutcome('req_1'), 'completed');
  assert.equal(c.isTerminal('req_1'), true);
  assert.equal(c.isReady(), true);
  assert.equal(c.pending.size, 0);
});

test('accepted 后尚无终态 → pending', () => {
  const c = new DriverCorrelator();
  const r = c.request('turn.send', {}, 'turn');
  c.handleLine(acceptedLine(r.id, 'req_x'));
  assert.equal(c.turnOutcome('req_x'), 'pending');
});

test('失败 / 取消 / 未知 / running 状态', () => {
  const cases = [['stopped', 'stopped'], ['error', 'failed'], ['weird', 'unknown'], [undefined, 'unknown']];
  for (const [status, expected] of cases) {
    const c = new DriverCorrelator();
    const r = c.request('turn.send', {}); c.handleLine(acceptedLine(r.id, 'req_' + status));
    c.handleLine(completedLine('req_' + status, status));
    assert.equal(c.turnOutcome('req_' + status), expected, `status=${status}`);
  }
  const c2 = new DriverCorrelator();
  const r2 = c2.request('turn.send', {}); c2.handleLine(acceptedLine(r2.id, 'req_run'));
  c2.handleLine(completedLine('req_run', 'running'));
  assert.equal(c2.turnOutcome('req_run'), 'pending');
  const c3 = new DriverCorrelator();
  const r3 = c3.request('turn.send', {}); c3.handleLine(acceptedLine(r3.id, 'req_f'));
  c3.handleLine(JSON.stringify({ method: 'turn.failed', params: { session_ref: 'sess_a', request_id: 'req_f', code: 'E', message: 'boom' } }));
  assert.equal(c3.turnOutcome('req_f'), 'failed');
});

test('未知响应 id / 重复响应 不落 responses', () => {
  const c = new DriverCorrelator();
  const unknown = c.handleLine('{"id":"nope","ok":true,"result":{}}');
  assert.equal(unknown.correlated, false);
  assert.equal(c.responses.has('nope'), false);
  const r = c.request('turn.send', {});
  c.handleLine(acceptedLine(r.id, 'req_1'));
  const dup = c.handleLine(acceptedLine(r.id, 'req_1'));
  assert.equal(dup.correlated, false);
  assert.equal(dup.reason, 'unknown-response-id');
});

test('会话不匹配的终态通知被忽略（不污染）', () => {
  const c = new DriverCorrelator();
  const r = c.request('turn.send', {}); c.handleLine(acceptedLine(r.id, 'req_1', 'sess_a'));
  c.handleLine(completedLine('req_1', 'complete', 'sess_B'));
  assert.equal(c.turnOutcome('req_1'), 'pending');
  assert.ok(c.unmatched.some((m) => m.reason === 'session-mismatch'));
});

test('多请求交错互不串扰', () => {
  const c = new DriverCorrelator();
  const a = c.request('turn.send', {}, 'turn');
  const b = c.request('turn.send', {}, 'turn');
  c.handleLine(acceptedLine(a.id, 'req_a', 'sess_a'));
  c.handleLine(acceptedLine(b.id, 'req_b', 'sess_b'));
  c.handleLine(completedLine('req_b', 'complete', 'sess_b'));
  assert.equal(c.turnOutcome('req_a'), 'pending');
  assert.equal(c.turnOutcome('req_b'), 'completed');
  c.handleLine(completedLine('req_a', 'error', 'sess_a'));
  assert.equal(c.turnOutcome('req_a'), 'failed');
});

test('终态确定后，迟到的（错误的）关联事件不能覆盖', () => {
  const c = new DriverCorrelator();
  const r = c.request('turn.send', {}); c.handleLine(acceptedLine(r.id, 'req_1'));
  c.handleLine(completedLine('req_1', 'complete'));
  c.handleLine(completedLine('req_1', 'error'));
  assert.equal(c.turnOutcome('req_1'), 'completed');
  assert.ok(c.unmatched.some((m) => m.reason === 'already-terminal'));
});

test('协议允许的乱序：终态通知先于 accepted 到达 → 有界缓存后重放', () => {
  const c = new DriverCorrelator();
  c.handleLine(completedLine('req_early', 'complete'));
  assert.equal(c.orphans.size, 1);
  const r = c.request('turn.send', {});
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
