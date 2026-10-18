import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseGatewayEvent, GatewayEventSequence, GatewayStreamMerger, GatewaySSEFramer, GatewayProtocolError } from '../../src/desktop/gateway-events.mjs';

const FULL = readFileSync(new URL('../../fixtures/desktop/gateway-stream.synthetic.sse.txt', import.meta.url), 'utf8');
const MISSING_USAGE = readFileSync(new URL('../../fixtures/desktop/gateway-missing-usage.synthetic.sse.txt', import.meta.url), 'utf8');
const ERROR_STREAM = readFileSync(new URL('../../fixtures/desktop/gateway-error.synthetic.sse.txt', import.meta.url), 'utf8');

function eventsOf(text) { const f = new GatewaySSEFramer(); return [...f.push(text).map(parseGatewayEvent), ...f.flush().map(parseGatewayEvent)]; }

test('完整流：序列通过、合并 content/thinking/tools/usage/stop_reason', () => {
  const events = eventsOf(FULL);
  const seq = new GatewayEventSequence();
  const m = new GatewayStreamMerger();
  for (const e of events) { seq.accept(e); m.apply(e); }
  seq.finish();
  assert.equal(m.content, 'OK');
  assert.equal(m.thinking, '思考中');
  assert.equal(m.usage.input_tokens, 10);
  assert.equal(m.stopReason, 'end_turn');
  const t = m.tools.get('tool_1');
  assert.equal(t.name, 'echo');
  assert.deepEqual(t.input, { a: 1 });
});

test('缺 usage：message_end 提前 → 抛错', () => {
  const seq = new GatewayEventSequence();
  assert.throws(() => { for (const e of eventsOf(MISSING_USAGE)) seq.accept(e); }, GatewayProtocolError);
});

test('usage 之后出现非 message_end → 抛错', () => {
  const seq = new GatewayEventSequence();
  seq.accept(parseGatewayEvent('{"type":"message_start","response_id":"r","model":"m"}'));
  seq.accept(parseGatewayEvent('{"type":"usage","usage":{"input_tokens":1,"output_tokens":1}}'));
  assert.throws(() => seq.accept(parseGatewayEvent('{"type":"content_delta","text":"x"}')), GatewayProtocolError);
});

test('未以 message_start 开始 / 无终止事件 → 抛错', () => {
  const seq = new GatewayEventSequence();
  assert.throws(() => seq.accept(parseGatewayEvent('{"type":"content_delta","text":"x"}')), /message_start/);
  const seq2 = new GatewayEventSequence();
  seq2.accept(parseGatewayEvent('{"type":"message_start","response_id":"r","model":"m"}'));
  assert.throws(() => seq2.finish(), /terminal/);
});

test('error 事件是终止；其后不得再有事件', () => {
  const m = new GatewayStreamMerger();
  for (const e of eventsOf(ERROR_STREAM)) m.apply(e);
  m.finish();
  assert.equal(m.error.code, 'E_SYNTH');
  assert.equal(m.stopReason, null);
  const seq = new GatewayEventSequence();
  seq.accept(parseGatewayEvent('{"type":"message_start","response_id":"r","model":"m"}'));
  seq.accept(parseGatewayEvent('{"type":"error","code":"X","message":"y","retryable":true}'));
  assert.throws(() => seq.accept(parseGatewayEvent('{"type":"usage","usage":{"input_tokens":1,"output_tokens":1}}')), /invalid/);
});

test('未知事件类型 → 抛错', () => {
  assert.throws(() => parseGatewayEvent('{"type":"nope"}'), GatewayProtocolError);
});

test('SSE 分帧：逐字节喂入结果一致（含 UTF-8 跨块）', () => {
  const f = new GatewaySSEFramer(); const raw = []; const buf = Buffer.from(FULL, 'utf8');
  for (let i = 0; i < buf.length; i++) raw.push(...f.push(buf.subarray(i, i + 1)));
  raw.push(...f.flush());
  const events = raw.map(parseGatewayEvent);
  assert.equal(events.length, 9);
  assert.equal(events.filter((e) => e.type === 'content_delta')[0].text, 'OK');
});
