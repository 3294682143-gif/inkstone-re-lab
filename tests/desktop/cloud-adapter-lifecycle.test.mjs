import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCloudAdapter, CloudAdapterError } from '../../src/desktop/cloud-adapter.mjs';

const BASE = 'https://example.invalid/api/orbit/v1';
const AUTH = { token: 'T', ssoUid: 'U', locale: 'zh-CN' };
const enc = new TextEncoder();
const env = (data) => ({ msg: 'ok', trace_id: 'tr', code: 0, data });

function abortErr() { const e = new Error('aborted'); e.name = 'AbortError'; return e; }
function wait(ms, signal) {
  return new Promise((res, rej) => {
    if (signal?.aborted) return rej(abortErr());
    const t = setTimeout(res, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); rej(abortErr()); }, { once: true });
  });
}
/** 立即返回响应头，但响应体延迟/不结束；尊重 AbortSignal。 */
function bodyResponse({ contentType, body, delayMs = 0, neverEnd = false, signal }) {
  const stream = new ReadableStream({
    start(c) {
      const push = () => c.enqueue(enc.encode(body));
      if (neverEnd) { /* 不结束 */ }
      else { const t = setTimeout(() => { push(); c.close(); }, delayMs); signal?.addEventListener('abort', () => { clearTimeout(t); c.error(abortErr()); }, { once: true }); }
      if (neverEnd) signal?.addEventListener('abort', () => { c.error(abortErr()); }, { once: true });
    },
  });
  return new Response(stream, { status: 200, headers: { 'content-type': contentType } });
}

test('响应头迟迟不返回 → 超时（timeout），且不伪装成 JSON 错误', async () => {
  const a = createCloudAdapter({ baseUrl: BASE, authority: AUTH, timeoutMs: 50, fetchImpl: (url, { signal }) => wait(500, signal).then(() => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })) });
  const t0 = Date.now();
  await assert.rejects(() => a.getModels(), (e) => e instanceof CloudAdapterError && e.kind === 'timeout');
  assert.ok(Date.now() - t0 < 400, '不应等到 500ms');
});

test('响应头立即返回，但 JSON body 延迟 → 超时', async () => {
  const a = createCloudAdapter({ baseUrl: BASE, authority: AUTH, timeoutMs: 50, fetchImpl: (url, { signal }) => Promise.resolve(bodyResponse({ contentType: 'application/json', body: JSON.stringify(env({ id: 1 })), delayMs: 500, signal })) });
  await assert.rejects(() => a.createConversation(), (e) => e.kind === 'timeout');
});

test('响应头立即返回，但 SSE 持续不结束 → 超时', async () => {
  const a = createCloudAdapter({ baseUrl: BASE, authority: AUTH, timeoutMs: 60, fetchImpl: (url, { signal }) => Promise.resolve(bodyResponse({ contentType: 'text/event-stream', body: 'data: {"type":"message_start","response_id":"r","model":"m"}\n\n', neverEnd: true, signal })) });
  await assert.rejects(() => a.startInference({ request_id: 'r1' }), (e) => e.kind === 'timeout');
});

test('调用前已 abort → 在发起请求前失败，且不进入 fetch', async () => {
  let called = 0;
  const a = createCloudAdapter({ baseUrl: BASE, authority: AUTH, timeoutMs: 5000, fetchImpl: () => { called++; return Promise.resolve(new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })); } });
  const ac = new AbortController(); ac.abort();
  await assert.rejects(() => a.createConversation({ signal: ac.signal }), (e) => e.kind === 'aborted');
  assert.equal(called, 0, '预取消不应进入 fetch');
});

test('读取过程中 abort → kind:aborted', async () => {
  const a = createCloudAdapter({ baseUrl: BASE, authority: AUTH, timeoutMs: 5000, fetchImpl: (url, { signal }) => Promise.resolve(bodyResponse({ contentType: 'application/json', body: JSON.stringify(env({ id: 1 })), neverEnd: true, signal })) });
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 30);
  await assert.rejects(() => a.createConversation({ signal: ac.signal }), (e) => e.kind === 'aborted');
});

test('正常完成后无残留 timer / signal 监听器', async () => {
  const timers = new Set();
  const origSet = global.setTimeout, origClear = global.clearTimeout;
  global.setTimeout = (...a) => { const t = origSet(...a); timers.add(t); return t; };
  global.clearTimeout = (t) => { timers.delete(t); return origClear(t); };
  const ac = new AbortController();
  let added = 0, removed = 0;
  const s = ac.signal, oa = s.addEventListener.bind(s), or = s.removeEventListener.bind(s);
  s.addEventListener = (...a) => { added++; return oa(...a); };
  s.removeEventListener = (...a) => { removed++; return or(...a); };
  try {
    const fetchImpl = (url, { signal }) => Promise.resolve(new Response(JSON.stringify(env({ id: 42 })), { status: 200, headers: { 'content-type': 'application/json' } }));
    const a = createCloudAdapter({ baseUrl: BASE, authority: AUTH, timeoutMs: 1000, fetchImpl });
    assert.equal(await a.createConversation({ signal: s }), 42);
  } finally {
    global.setTimeout = origSet; global.clearTimeout = origClear;
  }
  assert.equal(timers.size, 0, '不应残留 timer');
  assert.equal(added, removed, '不应残留 abort 监听器');
});

test('各公开 JSON 方法都传递 signal，且可被调用方取消', async () => {
  for (const call of ['createConversation', 'getModels', 'startInference']) {
    const captured = [];
    const ct = call === 'startInference' ? 'text/event-stream' : 'application/json';
    const fetchImpl = (url, { signal }) => { captured.push(signal); return Promise.resolve(bodyResponse({ contentType: ct, body: call === 'startInference' ? 'data: {"type":"message_start","response_id":"r","model":"m"}\n\n' : JSON.stringify(env({})), neverEnd: true, signal })); };
    const a = createCloudAdapter({ baseUrl: BASE, authority: AUTH, timeoutMs: 5000, fetchImpl });
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 30);
    const invoke = call === 'startInference' ? () => a.startInference({ request_id: 'r1' }, { signal: ac.signal }) : () => a[call]({ signal: ac.signal });
    await assert.rejects(invoke, (e) => e.kind === 'aborted', `${call} 应可取消`);
    assert.equal(captured.length, 1, `${call} 应调用 fetch 一次`);
    assert.equal(captured[0].aborted, true, `${call} 取消应传播到 fetch signal`);
  }
});

test('timeoutMs=0 → 不设超时（长延迟仍可完成）', async () => {
  const a = createCloudAdapter({ baseUrl: BASE, authority: AUTH, timeoutMs: 0, fetchImpl: (url, { signal }) => Promise.resolve(bodyResponse({ contentType: 'application/json', body: JSON.stringify(env({ id: 7 })), delayMs: 80, signal })) });
  assert.equal(await a.createConversation(), 7);
});
