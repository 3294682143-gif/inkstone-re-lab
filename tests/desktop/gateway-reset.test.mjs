import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseGatewayEvent, GatewaySSEFramer, GatewayStreamMerger } from '../../src/desktop/gateway-events.mjs';

const FULL = readFileSync(new URL('../../fixtures/desktop/gateway-stream.synthetic.sse.txt', import.meta.url), 'utf8');
const enc = new TextEncoder();
function feed(merger, text) {
  const framer = new GatewaySSEFramer();
  for (const raw of [...framer.push(text), ...framer.flush()]) merger.apply(parseGatewayEvent(raw));
  merger.finish();
  return merger;
}
function synthStream({ responseId, model, answer, toolId }) {
  const events = [
    { type: 'message_start', response_id: responseId, model },
    { type: 'content_delta', text: answer },
    { type: 'tool_use_start', id: toolId, name: 'echo' },
    { type: 'tool_use_end', id: toolId, input: { a: 1 } },
    { type: 'usage', usage: { input_tokens: 1, output_tokens: 1 } },
    { type: 'message_end', stop_reason: 'end_turn' },
  ];
  return events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
}

test('同一实例连续处理两条完整合法流（中间 reset）不误报', () => {
  const m = new GatewayStreamMerger();
  feed(m, FULL);
  assert.equal(m.content, 'OK');

  m.reset();
  const second = synthStream({ responseId: 'resp_2', model: 'model-2', answer: 'SECOND', toolId: 'tool_2' });
  feed(m, second);                       // 旧实现会抛 "event sequence is invalid"
  assert.equal(m.content, 'SECOND');
  assert.equal(m.responseId, 'resp_2');
  assert.equal(m.model, 'model-2');
  assert.equal(m.stopReason, 'end_turn');
});

test('reset 清理第一条流的所有单流状态', () => {
  const m = new GatewayStreamMerger();
  feed(m, FULL);
  m.reset();
  assert.equal(m.responseId, null);
  assert.equal(m.model, null);
  assert.equal(m.thinking, '');
  assert.equal(m.content, '');
  assert.equal(m.tools.size, 0);
  assert.equal(m.toolOrder.length, 0);
  assert.equal(m.usage, null);
  assert.equal(m.stopReason, null);
  assert.equal(m.error, null);
  assert.equal(m.terminal, false);
  assert.equal(m.events, 0);
  assert.equal(m._seq, undefined);
});

test('第二条流不残留第一条的文本/工具/usage/错误/响应标识', () => {
  const m = new GatewayStreamMerger();
  feed(m, FULL);                          // 第一条含 tool_1、usage、responseId
  m.reset();
  feed(m, synthStream({ responseId: 'resp_2', model: 'model-2', answer: 'X', toolId: 'tool_2' }));
  assert.equal(m.tools.has('tool_1'), false);
  assert.equal(m.tools.has('tool_2'), true);
  assert.equal(m.usage.input_tokens, 1);
  assert.notEqual(m.responseId, 'resp_synth_1');
  assert.equal(m.error, null);
});

test('错误流后 reset 仍可处理正常新流', () => {
  const m = new GatewayStreamMerger();
  feed(m, 'data: {"type":"message_start","response_id":"r","model":"m"}\n\ndata: {"type":"error","code":"E","message":"x","retryable":false}\n\n');
  assert.equal(m.error.code, 'E');
  m.reset();
  feed(m, synthStream({ responseId: 'resp_ok', model: 'm2', answer: 'OK', toolId: 't' }));
  assert.equal(m.error, null);
  assert.equal(m.content, 'OK');
  assert.equal(m.stopReason, 'end_turn');
});

test('reset 传入 UTF-8 分块场景保持一致（跨字节）', () => {
  const m = new GatewayStreamMerger();
  feed(m, FULL);
  m.reset();
  const framer = new GatewaySSEFramer();
  const buf = enc.encode(synthStream({ responseId: 'r2', model: 'm2', answer: '跨块文本', toolId: 't2' }));
  const raws = [];
  for (let i = 0; i < buf.length; i++) raws.push(...framer.push(buf.subarray(i, i + 1)));
  raws.push(...framer.flush());
  for (const raw of raws) m.apply(parseGatewayEvent(raw));
  m.finish();
  assert.equal(m.content, '跨块文本');
});
