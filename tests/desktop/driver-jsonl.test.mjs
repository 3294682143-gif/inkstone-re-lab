import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JsonlFramer, parseRequestLine, parseMessage, encodeRequest, DriverCorrelator, HEADLESS_CHAT_PROTOCOL_VERSION, DriverProtocolError } from '../../src/desktop/driver-jsonl.mjs';

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

test('关联器：ready/响应关联/turn 完成或失败/accepted≠completed', () => {
  const c = new DriverCorrelator();
  const lines = SESSION.trim().split('\n');
  for (const l of lines) c.handleLine(l);
  assert.equal(c.isReady(), true);
  assert.equal(c.ready, HEADLESS_CHAT_PROTOCOL_VERSION);
  const turnResp = c.responses.get('turn-1');
  assert.equal(DriverCorrelator.isAccepted(turnResp), true);            // 已受理
  assert.equal(c.turnOutcome('req_synth_1'), 'completed');              // 真正完成来自通知
  assert.equal(c.pending.size, 0);
});

test('accepted:true 单独不构成完成', () => {
  const c = new DriverCorrelator();
  c.handleLine('{"id":"turn-1","ok":true,"result":{"accepted":true,"request_id":"req_x","session_ref":"s"}}');
  assert.equal(c.turnOutcome('req_x'), 'pending');
});

test('turn.failed 通知 → 失败终态', () => {
  const c = new DriverCorrelator();
  c.handleLine('{"method":"turn.failed","params":{"request_id":"req_y","session_ref":"s"}}');
  assert.equal(c.turnOutcome('req_y'), 'failed');
});
