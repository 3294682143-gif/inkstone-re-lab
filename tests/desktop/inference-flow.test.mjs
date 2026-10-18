// R3 离线集成闭环：新建→推理→终态→本地轮次同步；追问；工具链路；取消；超时/错误/缺结束；冲突恢复；多回合隔离。
// 全部使用注入 fetch / 合成数据；不启动 Electron、不联网、不运行真实工具。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCloudAdapter, CloudAdapterError } from '../../src/desktop/cloud-adapter.mjs';
import { GatewayProtocolError } from '../../src/desktop/gateway-events.mjs';
import { inferenceConflictCode, canRecoverInferenceConflict, shouldRetryInferenceConflict } from '../../src/desktop/recovery.mjs';

const BASE = 'https://example.invalid/api/orbit/v1';
const AUTH = { token: 'T', ssoUid: 'U', locale: 'zh-CN' };
const env = (data) => ({ msg: 'ok', trace_id: 'tr', code: 0, data });
const enc = new TextEncoder();

// 合成 gateway SSE（与 fixtures/desktop 同协议：data: {type,...}\n\n）
const gsse = (events) => events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
function streamResponse({ contentType = 'text/event-stream', body, delayMs = 0, neverEnd = false, signal }) {
  const stream = new ReadableStream({
    start(c) {
      if (neverEnd) { signal?.addEventListener('abort', () => c.error(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true }); return; }
      const t = setTimeout(() => { c.enqueue(enc.encode(body)); c.close(); }, delayMs);
      signal?.addEventListener('abort', () => { clearTimeout(t); c.error(Object.assign(new Error('aborted'), { name: 'AbortError' })); }, { once: true });
    },
  });
  return new Response(stream, { status: 200, headers: { 'content-type': contentType } });
}
function routerFetch(routes) {
  const calls = [];
  const fn = (url, opts) => { calls.push({ url, opts, path: new URL(url).pathname }); const r = routes(url, opts); return Promise.resolve(r); };
  fn.calls = calls;
  return fn;
}
const okTurn = (cid, answer = 'OK', opts = {}) => gsse([
  { type: 'message_start', response_id: `resp_${cid}`, model: 'synth-model' },
  ...(opts.tool ? [
    { type: 'tool_use_start', id: 'call_1', name: 'echo' },
    { type: 'tool_input_delta', id: 'call_1', partial_json: '{"x":' },
    { type: 'tool_input_delta', id: 'call_1', partial_json: '1}' },
    { type: 'tool_use_end', id: 'call_1', input: { x: 1 } },
  ] : []),
  { type: 'content_delta', text: answer },
  { type: 'usage', usage: { input_tokens: 3, output_tokens: 2, cache_read_tokens: 0, cache_write_tokens: 0 } },
  { type: 'message_end', stop_reason: opts.tool ? 'tool_use' : 'end_turn' },
]);

test('S1 新建会话 → 首轮推理 → usage/终态 → 本地轮次同步', async () => {
  const fetchImpl = routerFetch((url) => {
    const p = new URL(url).pathname;
    if (p.endsWith('/chat/new')) return Response.json(env({ id: 5001 }), { headers: { 'content-type': 'application/json' } });
    if (p.endsWith('/local-agent/messages')) return streamResponse({ body: okTurn(5001), delayMs: 5 });
    if (p.endsWith('/local-turns')) return Response.json(env({ turn_id: 't1', message_id: 7, status: 'running', checkpoint_seq: 0 }), { headers: { 'content-type': 'application/json' } });
    if (p.endsWith('/complete')) return Response.json(env({ turn_id: 't1', message_id: 7, status: 'complete', checkpoint_seq: 1, usage: { input_tokens: 3, output_tokens: 2 } }), { headers: { 'content-type': 'application/json' } });
    throw new Error('unexpected ' + p);
  });
  const a = createCloudAdapter({ baseUrl: BASE, authority: AUTH, timeoutMs: 2000, fetchImpl });
  const chatId = await a.createConversation();
  assert.equal(chatId, 5001);
  const inf = await a.startInference({ protocol_version: '2.0', inference_kind: 'turn', lifecycle_owner: 'turn', chat_id: chatId, turn_id: 't1', request_id: 'req1', model: 'synth-model', messages: [], tools: [] });
  assert.equal(inf.content, 'OK');
  assert.equal(inf.stopReason, 'end_turn');
  assert.deepEqual(inf.usage, { input_tokens: 3, output_tokens: 2, cache_read_tokens: 0, cache_write_tokens: 0 });
  // lifecycle_owner 不得出现在发出体
  const sent = JSON.parse(fetchImpl.calls.find((c) => c.path.endsWith('/local-agent/messages')).opts.body);
  assert.equal('lifecycle_owner' in sent, false);
  const start = await a.conversationStart(chatId, { request_id: 'req1', turn_id: 't1', body_marker: 'synthetic' });
  assert.deepEqual(start, { turnId: 't1', messageId: 7, status: 'running', checkpointSeq: 0 });
  const done = await a.conversationComplete(chatId, 't1', { usage: 'synthetic' });
  assert.equal(done.status, 'complete');
  assert.equal(done.usage.output_tokens, 2);
});

test('S2 复用会话追问（同一 chat_id，不同 request/轮次）', async () => {
  const seen = [];
  const fetchImpl = routerFetch((url, opts) => {
    const p = new URL(url).pathname;
    if (p.endsWith('/local-agent/messages')) { seen.push(JSON.parse(opts.body)); return streamResponse({ body: okTurn(5002, 'AGAIN'), delayMs: 5 }); }
    throw new Error('unexpected ' + p);
  });
  const a = createCloudAdapter({ baseUrl: BASE, authority: AUTH, timeoutMs: 2000, fetchImpl });
  await a.startInference({ inference_kind: 'turn', lifecycle_owner: 'turn', chat_id: 5002, turn_id: 't1', request_id: 'req1', model: 'm', messages: [], tools: [] });
  const r2 = await a.startInference({ inference_kind: 'turn', lifecycle_owner: 'turn', chat_id: 5002, turn_id: 't2', request_id: 'req2', model: 'm', messages: [], tools: [] });
  assert.equal(r2.content, 'AGAIN');
  assert.equal(seen.length, 2);
  assert.equal(seen[0].chat_id, seen[1].chat_id);
  assert.notEqual(seen[0].request_id, seen[1].request_id);
  assert.notEqual(seen[0].turn_id, seen[1].turn_id);
});

test('S3 工具调用片段 → 输入合并 → 合成工具结果关联', async () => {
  const fetchImpl = routerFetch((url) => streamResponse({ body: okTurn(5003, 'done', { tool: true }), delayMs: 5 }));
  const a = createCloudAdapter({ baseUrl: BASE, authority: AUTH, timeoutMs: 2000, fetchImpl });
  const inf = await a.startInference({ inference_kind: 'turn', lifecycle_owner: 'turn', chat_id: 5003, turn_id: 't1', request_id: 'req1', model: 'm', messages: [], tools: [] });
  assert.equal(inf.tools.length, 1);
  assert.equal(inf.tools[0].name, 'echo');
  assert.deepEqual(inf.tools[0].input, { x: 1 });              // tool_use_end 的输入
  assert.equal(inf.tools[0].inputJson, '{"x":1}');            // 增量合并
  // 合成工具结果（不运行真实工具）：按 id 关联
  const toolResult = { tool_use_id: inf.tools[0].id, content: 'synthetic-ok', is_error: false };
  assert.equal(toolResult.tool_use_id, 'call_1');
});

test('S4 用户取消 → 清理 → aborted（有界）', async () => {
  const fetchImpl = routerFetch((url, opts) => streamResponse({ body: '', neverEnd: true, signal: opts.signal }));
  const a = createCloudAdapter({ baseUrl: BASE, authority: AUTH, timeoutMs: 5000, fetchImpl });
  const ac = new AbortController(); setTimeout(() => ac.abort(), 30);
  const t0 = Date.now();
  await assert.rejects(() => a.startInference({ request_id: 'req1' }, { signal: ac.signal }), (e) => e.kind === 'aborted');
  assert.ok(Date.now() - t0 < 800);
});

test('S5 超时 / 错误事件 / 缺结束事件', async () => {
  const to = createCloudAdapter({ baseUrl: BASE, authority: AUTH, timeoutMs: 60, fetchImpl: routerFetch((url, opts) => streamResponse({ body: '', neverEnd: true, signal: opts.signal })) });
  await assert.rejects(() => to.startInference({ request_id: 'r' }), (e) => e.kind === 'timeout');
  const errBody = gsse([{ type: 'message_start', response_id: 'r', model: 'm' }, { type: 'error', code: 'E_X', message: 'boom', retryable: false }]);
  const er = createCloudAdapter({ baseUrl: BASE, authority: AUTH, timeoutMs: 1000, fetchImpl: routerFetch(() => streamResponse({ body: errBody, delayMs: 5 })) });
  await assert.rejects(() => er.startInference({ request_id: 'r' }), (e) => e.kind === 'remote_rejected');
  const noEnd = gsse([{ type: 'message_start', response_id: 'r', model: 'm' }, { type: 'usage', usage: { input_tokens: 1, output_tokens: 1 } }]);
  const ne = createCloudAdapter({ baseUrl: BASE, authority: AUTH, timeoutMs: 1000, fetchImpl: routerFetch(() => streamResponse({ body: noEnd, delayMs: 5 })) });
  await assert.rejects(() => ne.startInference({ request_id: 'r' }), (e) => e instanceof GatewayProtocolError);
});

test('S6 冲突恢复判定（已确认规则；无证明则不恢复）', () => {
  assert.equal(inferenceConflictCode({ code: 409001, data: { reason: 'TURN_CONFLICT' } }, 'turn'), 'TURN_CONFLICT_RECOVERY');
  assert.equal(inferenceConflictCode({ code: 409005, data: { reason: 'INFERENCE_ALREADY_RUNNING', retryable: true } }, 'turn'), 'INFERENCE_LEASE_RECOVERY');
  assert.equal(inferenceConflictCode({ code: 409005, data: { reason: 'INFERENCE_ALREADY_RUNNING', retryable: false } }, 'turn'), undefined);
  assert.equal(inferenceConflictCode({ code: 409001, data: { reason: 'TURN_CONFLICT', ambiguous: true } }, 'turn'), undefined);
  const now = 100000;
  assert.equal(canRecoverInferenceConflict({ recoveryProof: { requestId: 'old', drainedAt: now - 1000 }, requestId: 'new', now }), true);
  assert.equal(canRecoverInferenceConflict({ recoveryProof: { requestId: 'new', drainedAt: now - 1000 }, requestId: 'new', now }), false);
  assert.equal(canRecoverInferenceConflict({ recoveryProof: { requestId: 'old', drainedAt: now - 9000 }, requestId: 'new', now }), false);
  assert.equal(canRecoverInferenceConflict({ recoveryProof: { requestId: 'old', drainedAt: now }, requestId: 'new', now, hasSibling: true }), false);
  assert.equal(shouldRetryInferenceConflict({ code: 'TURN_CONFLICT_RECOVERY', attempt: 0, recoverable: true }), true);
  assert.equal(shouldRetryInferenceConflict({ code: 'TURN_CONFLICT_RECOVERY', attempt: 1, recoverable: true }), false);
  assert.equal(shouldRetryInferenceConflict({ code: undefined, attempt: 0, recoverable: true }), false);
});

test('S7 多回合标识符/结果不串扰', async () => {
  const seen = [];
  const fetchImpl = routerFetch((url, opts) => { seen.push(JSON.parse(opts.body)); return streamResponse({ body: okTurn(0, String(JSON.parse(opts.body).request_id)), delayMs: 5 }); });
  const a = createCloudAdapter({ baseUrl: BASE, authority: AUTH, timeoutMs: 1000, fetchImpl });
  const rA = await a.startInference({ inference_kind: 'turn', lifecycle_owner: 'turn', chat_id: 6001, turn_id: 'A', request_id: 'reqA', model: 'm', messages: [], tools: [] });
  const rB = await a.startInference({ inference_kind: 'turn', lifecycle_owner: 'turn', chat_id: 6002, turn_id: 'B', request_id: 'reqB', model: 'm', messages: [], tools: [] });
  assert.equal(rA.content, 'reqA');
  assert.equal(rB.content, 'reqB');
  assert.deepEqual(seen.map((b) => b.chat_id), [6001, 6002]);
  assert.deepEqual(seen.map((b) => b.turn_id), ['A', 'B']);
});
