import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCloudAdapter, buildNewConversationBody, buildInferenceBody, buildAuthorityHeaders, CloudAdapterError } from '../../src/desktop/cloud-adapter.mjs';
import { GatewayProtocolError } from '../../src/desktop/gateway-events.mjs';
import { countingFetch, jsonResponse, sseResponse } from '../helpers.mjs';

const FULL = readFileSync(new URL('../../fixtures/desktop/gateway-stream.synthetic.sse.txt', import.meta.url), 'utf8');
const MISSING_USAGE = readFileSync(new URL('../../fixtures/desktop/gateway-missing-usage.synthetic.sse.txt', import.meta.url), 'utf8');
const CAPS = JSON.parse(readFileSync(new URL('../../fixtures/desktop/models.synthetic.json', import.meta.url), 'utf8'));
const BASE = 'https://example.invalid/api/orbit/v1';
const AUTH = { token: 'T', ssoUid: 'U', locale: 'zh-CN' };
const env = (data) => ({ msg: 'ok', trace_id: 'tr', code: 0, data });

test('请求体：新建会话为 scenario:2 桌面形态；推理体删除 lifecycle_owner', () => {
  assert.deepEqual(buildNewConversationBody(), { scenario: 2, type: 0, provider: 0, agent: 'local_agent' });
  assert.deepEqual(buildInferenceBody({ a: 1, lifecycle_owner: 'x' }), { a: 1 });
});

test('身份头：Authorization/id/Accept-Language，且 credentials:omit', async () => {
  const seen = countingFetch(() => jsonResponse(env({ id: 1 })));
  const a = createCloudAdapter({ baseUrl: BASE, authority: AUTH, fetchImpl: seen });
  await a.createConversation();
  const { opts } = seen.calls[0];
  assert.equal(opts.headers.Authorization, 'Bearer T');
  assert.equal(opts.headers.id, 'U');
  assert.equal(opts.headers['Accept-Language'], 'zh-CN');
  assert.equal(opts.credentials, 'omit');
  assert.equal(opts.redirect, 'error');
});

test('createConversation：合法 id', async () => {
  const a = createCloudAdapter({ baseUrl: BASE, authority: AUTH, fetchImpl: countingFetch(() => jsonResponse(env({ id: 777 }))) });
  assert.equal(await a.createConversation(), 777);
});

test('getModels：解析能力目录', async () => {
  const a = createCloudAdapter({ baseUrl: BASE, authority: AUTH, fetchImpl: countingFetch(() => jsonResponse(env(CAPS))) });
  const caps = await a.getModels();
  assert.equal(caps.protocol_version, '2.0');
});

test('startInference：完整 SSE → 合并结果', async () => {
  const a = createCloudAdapter({ baseUrl: BASE, authority: AUTH, fetchImpl: countingFetch(() => sseResponse([FULL])) });
  const r = await a.startInference({ request_id: 'r1', messages: [] });
  assert.equal(r.content, 'OK');
  assert.equal(r.stopReason, 'end_turn');
  assert.equal(r.usage.input_tokens, 10);
});

test('startInference：缺 usage/终止 → 抛错（不得当作成功）', async () => {
  const a = createCloudAdapter({ baseUrl: BASE, authority: AUTH, fetchImpl: countingFetch(() => sseResponse([MISSING_USAGE])) });
  await assert.rejects(() => a.startInference({ request_id: 'r1' }), GatewayProtocolError);
});

test('startInference：200 但非 SSE（错误 JSON）→ 抛错', async () => {
  const a = createCloudAdapter({ baseUrl: BASE, authority: AUTH, fetchImpl: countingFetch(() => jsonResponse({ msg: 'err', trace_id: 't', code: -1 })) });
  await assert.rejects(() => a.startInference({ request_id: 'r1' }), /not a valid SSE stream/);
});

test('startInference：401 → auth 错误', async () => {
  const a = createCloudAdapter({ baseUrl: BASE, authority: AUTH, fetchImpl: countingFetch(() => new Response('nope', { status: 401 })) });
  await assert.rejects(() => a.startInference({ request_id: 'r1' }), (e) => e instanceof CloudAdapterError && e.kind === 'auth');
});

test('envelope code!=0 → remote_rejected', async () => {
  const a = createCloudAdapter({ baseUrl: BASE, authority: AUTH, fetchImpl: countingFetch(() => jsonResponse({ msg: 'x', trace_id: 't', code: -10002, data: {} })) });
  await assert.rejects(() => a.createConversation(), (e) => e.kind === 'remote_rejected');
});

test('checkpoint 结果缺 applied → 抛错', async () => {
  const a = createCloudAdapter({ baseUrl: BASE, authority: AUTH, fetchImpl: countingFetch(() => jsonResponse(env({ status: 'x' }))) });
  await assert.rejects(() => a.conversationCheckpoint(1, 't1', {}), /checkpoint result invalid/);
});
