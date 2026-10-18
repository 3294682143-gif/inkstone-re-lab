import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCloudAdapter, CloudAdapterError, safeCancel } from '../../src/desktop/cloud-adapter.mjs';

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

test('有界清理：reader.cancel 永不 resolve 时，safeCancel 仍在限定时间内返回', async () => {
  const t0 = Date.now();
  await safeCancel({ cancel: () => new Promise(() => {}) }, 200);
  const dt = Date.now() - t0;
  assert.ok(dt < 800, `应在限定时间返回（实际 ${dt}ms）`);
});

test('正常 SSE 完成后仍正常返回（清理不阻塞成功）', async () => {
  const a = createCloudAdapter({ baseUrl: BASE, authority: AUTH, timeoutMs: 1000, fetchImpl: (url, { signal }) => Promise.resolve(bodyResponse({ contentType: 'text/event-stream', body: 'data: {"type":"message_start","response_id":"r","model":"m"}\n\ndata: {"type":"usage","usage":{"input_tokens":1,"output_tokens":1}}\n\ndata: {"type":"message_end","stop_reason":"end_turn"}\n\n', delayMs: 5, signal })) });
  const r = await a.startInference({ request_id: 'r1' });
  assert.equal(r.stopReason, 'end_turn');
});

// ============ R1-B：safeCancel 有界兑现与释放锁 ============
test('B1 独立子进程：cancel 永不结束时，等待仍兑现且退出码为 0', () => {
  const dir = mkdtempSync(join(tmpdir(), 'inkstone-safe-'));
  const mod = fileURLToPath(new URL('../../src/desktop/cloud-adapter.mjs', import.meta.url));
  const script = join(dir, 'probe.mjs');
  writeFileSync(script, `import { safeCancel } from ${JSON.stringify(mod)};\nawait safeCancel({ cancel: () => new Promise(() => {}) }, 50);\nconsole.log('cleanup-finished');\n`);
  const out = execFileSync(process.execPath, [script], { encoding: 'utf8', timeout: 15000 });
  assert.match(out, /cleanup-finished/);           // execFileSync 在非零退出时抛错 => 隐含断言退出码为 0
});

test('B2 cancel 同步抛错 / 异步拒绝 / 正常结束 都不抛出', async () => {
  await safeCancel({ cancel: () => { throw new Error('sync'); } }, 50);
  await safeCancel({ cancel: () => Promise.reject(new Error('async')) }, 50);
  await safeCancel({ cancel: () => Promise.resolve() }, 50);
});

test('B3 有界：cancel 永不 resolve 也在限定时间内返回', async () => {
  const t0 = Date.now();
  await safeCancel({ cancel: () => new Promise(() => {}) }, 200);
  assert.ok(Date.now() - t0 < 900);
});

test('B4 正常 SSE 消费结束后 reader 锁被释放（body.locked=false）', async () => {
  let held;
  const fetchImpl = (url, { signal }) => Promise.resolve(bodyResponse({
    contentType: 'text/event-stream', delayMs: 5, signal,
    body: 'data: {"type":"message_start","response_id":"r","model":"m"}\n\ndata: {"type":"usage","usage":{"input_tokens":1,"output_tokens":1}}\n\ndata: {"type":"message_end","stop_reason":"end_turn"}\n\n',
  }));
  const a = createCloudAdapter({ baseUrl: BASE, authority: AUTH, timeoutMs: 1000, fetchImpl: (u, o) => { held = null; const p = fetchImpl(u, o); return p.then((res) => { held = res; return res; }); } });
  const r = await a.startInference({ request_id: 'r1' });
  assert.equal(r.stopReason, 'end_turn');
  assert.equal(held.body.locked, false, '消费结束后应释放 reader 锁');
});

// ============ R1-C：非 SSE 错误响应不吞取消/超时 ============
test('C1 非 SSE + body 迟迟不结束 → deadline 保留 timeout', async () => {
  const a = createCloudAdapter({ baseUrl: BASE, authority: AUTH, timeoutMs: 60, fetchImpl: (url, { signal }) => Promise.resolve(bodyResponse({ contentType: 'application/json', body: '{"msg":"x"}', neverEnd: true, signal })) });
  const t0 = Date.now();
  await assert.rejects(() => a.startInference({ request_id: 'r1' }), (e) => e.kind === 'timeout');
  assert.ok(Date.now() - t0 < 500);
});

test('C2 非 SSE + body 迟迟不结束 → 调用方 abort 保留 aborted', async () => {
  const a = createCloudAdapter({ baseUrl: BASE, authority: AUTH, timeoutMs: 5000, fetchImpl: (url, { signal }) => Promise.resolve(bodyResponse({ contentType: 'application/json', body: '{"msg":"x"}', neverEnd: true, signal })) });
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 30);
  await assert.rejects(() => a.startInference({ request_id: 'r1' }, { signal: ac.signal }), (e) => e.kind === 'aborted');
});

test('C3 非 SSE 但正常收到正文 → 仍按 invalid_response/http 分类', async () => {
  const ok = createCloudAdapter({ baseUrl: BASE, authority: AUTH, timeoutMs: 500, fetchImpl: () => Promise.resolve(bodyResponse({ contentType: 'application/json', body: '{"msg":"x"}', delayMs: 5 })) });
  await assert.rejects(() => ok.startInference({ request_id: 'r1' }), (e) => e.kind === 'invalid_response');
  const bad = createCloudAdapter({ baseUrl: BASE, authority: AUTH, timeoutMs: 500, fetchImpl: () => Promise.resolve(new Response('boom', { status: 500, headers: { 'content-type': 'text/plain' } })) });
  await assert.rejects(() => bad.startInference({ request_id: 'r1' }), (e) => e.kind === 'http' && e.status === 500);
});

test('C4 超时后有限时间内结束（不会挂住）', async () => {
  const a = createCloudAdapter({ baseUrl: BASE, authority: AUTH, timeoutMs: 60, fetchImpl: (url, { signal }) => Promise.resolve(bodyResponse({ contentType: 'application/json', body: '{}', neverEnd: true, signal })) });
  const t0 = Date.now();
  await assert.rejects(() => a.startInference({ request_id: 'r1' }), (e) => e.kind === 'timeout');
  assert.ok(Date.now() - t0 < 500, '应在限定时间内结束');
});
