import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCloudAdapter, CloudAdapterError } from '../../src/desktop/cloud-adapter.mjs';
import { countingFetch, jsonResponse } from '../helpers.mjs';

const BASE = 'https://example.invalid/api/orbit/v1';
const AUTH = { token: 'T', ssoUid: 'U', locale: 'zh-CN' };
const env = (data) => ({ msg: 'ok', trace_id: 'tr', code: 0, data });
const mk = (handler) => createCloudAdapter({ baseUrl: BASE, authority: AUTH, timeoutMs: 1000, fetchImpl: countingFetch(handler) });
const validStart = () => jsonResponse(env({ turn_id: 't1', message_id: 5, status: 'running', checkpoint_seq: 0 }));
const validCheckpoint = () => jsonResponse(env({ applied: true, status: 'running', checkpoint_seq: 3 }));
const validComplete = () => jsonResponse(env({ turn_id: 't1', message_id: 5, status: 'complete', checkpoint_seq: 4, usage: { input_tokens: 1, output_tokens: 2, cache_read_tokens: 0, cache_write_tokens: 0 } }));

test('合法响应被正确解析', async () => {
  const s = await mk(validStart).conversationStart(10, {});
  assert.deepEqual(s, { turnId: 't1', messageId: 5, status: 'running', checkpointSeq: 0 });
  const cp = await mk(validCheckpoint).conversationCheckpoint(10, 't1', {});
  assert.deepEqual(cp, { applied: true, status: 'running', checkpointSeq: 3 });
  const cm = await mk(validComplete).conversationComplete(10, 't1', {});
  assert.equal(cm.status, 'complete');
  assert.deepEqual(cm.usage, { input_tokens: 1, output_tokens: 2, cache_read_tokens: 0, cache_write_tokens: 0 });
});

test('conversationStart：空对象/缺字段/错误类型/非法状态 都拒绝', async () => {
  const bad = [
    env({}),
    env({ turn_id: 't1', message_id: 5, status: 'running' }),                       // 缺 checkpoint_seq
    env({ turn_id: '', message_id: 5, status: 'running', checkpoint_seq: 0 }),        // 空 turn_id
    env({ turn_id: 't1', message_id: -1, status: 'running', checkpoint_seq: 0 }),     // 负 message_id
    env({ turn_id: 't1', message_id: 1.5, status: 'running', checkpoint_seq: 0 }),    // 小数
    env({ turn_id: 't1', message_id: 2 ** 53, status: 'running', checkpoint_seq: 0 }), // 超安全整数
    env({ turn_id: 't1', message_id: 5, status: 'weird', checkpoint_seq: 0 }),        // 未知状态
    env({ turn_id: 't1', message_id: 5, status: 'running', checkpoint_seq: -1 }),     // 负 seq
  ];
  for (const d of bad) {
    await assert.rejects(() => mk(() => jsonResponse(d)).conversationStart(10, {}), (e) => e instanceof CloudAdapterError && e.kind === 'invalid_response');
  }
});

test('conversationCheckpoint：缺 applied / 类型错 / 状态错 都拒绝', async () => {
  const bad = [
    env({ status: 'running', checkpoint_seq: 3 }),
    env({ applied: 'yes', status: 'running', checkpoint_seq: 3 }),
    env({ applied: true, status: 'nope', checkpoint_seq: 3 }),
    env({ applied: true, status: 'running', checkpoint_seq: 1.5 }),
    env({}),
  ];
  for (const d of bad) {
    await assert.rejects(() => mk(() => jsonResponse(d)).conversationCheckpoint(10, 't1', {}), (e) => e.kind === 'invalid_response');
  }
});

test('conversationComplete：缺 usage / usage 非法 / 标识不一致 都拒绝', async () => {
  const bad = [
    env({ turn_id: 't1', message_id: 5, status: 'complete', checkpoint_seq: 4 }),                       // 缺 usage
    env({ turn_id: 't1', message_id: 5, status: 'complete', checkpoint_seq: 4, usage: {} }),            // usage 缺 tokens
    env({ turn_id: 't1', message_id: 5, status: 'complete', checkpoint_seq: 4, usage: { input_tokens: -1, output_tokens: 2 } }),
    env({ turn_id: 't1', message_id: 5, status: 'complete', checkpoint_seq: 4, usage: { input_tokens: 1.5, output_tokens: 2 } }),
    env({ turn_id: 'OTHER', message_id: 5, status: 'complete', checkpoint_seq: 4, usage: { input_tokens: 1, output_tokens: 2 } }), // 与请求 turnId 不一致
    env({ turn_id: 't1', message_id: 2 ** 53, status: 'complete', checkpoint_seq: 4, usage: { input_tokens: 1, output_tokens: 2 } }),
  ];
  for (const d of bad) {
    await assert.rejects(() => mk(() => jsonResponse(d)).conversationComplete(10, 't1', {}), (e) => e.kind === 'invalid_response');
  }
});

test('usage 可选缓存字段：可缺省，出现则须为非负安全整数', async () => {
  const okNoCache = await mk(() => jsonResponse(env({ turn_id: 't1', message_id: 5, status: 'complete', checkpoint_seq: 4, usage: { input_tokens: 1, output_tokens: 2 } }))).conversationComplete(10, 't1', {});
  assert.deepEqual(okNoCache.usage, { input_tokens: 1, output_tokens: 2 });
  await assert.rejects(() => mk(() => jsonResponse(env({ turn_id: 't1', message_id: 5, status: 'complete', checkpoint_seq: 4, usage: { input_tokens: 1, output_tokens: 2, cache_read_tokens: -1 } }))).conversationComplete(10, 't1', {}), (e) => e.kind === 'invalid_response');
});

test('参数校验在联网之前：非法 chatId / turnId 不触发 fetch', async () => {
  const f = countingFetch(() => jsonResponse(validStart()));
  const a = createCloudAdapter({ baseUrl: BASE, authority: AUTH, timeoutMs: 1000, fetchImpl: f });
  await assert.rejects(() => a.conversationStart(-1, {}), (e) => e.kind === 'invalid_response');
  await assert.rejects(() => a.conversationComplete(10, '', {}), (e) => e.kind === 'invalid_response');
  assert.equal(f.count(), 0);
});
