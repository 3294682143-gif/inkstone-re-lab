// 客户端离线测试：通过依赖注入（fetchImpl/readAuth）测试网络行为，不访问真实站点。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../src/client.mjs';
import { countingFetch, readAuthFake, sseResponse, jsonResponse, sseFromEvents, completeEvents, incompleteEvents } from './helpers.mjs';

const NULL_ENV = {}; // 无代理、无 base-url 覆盖 => 直连（且 fetch 被注入，不会真联网）
function cap() { const lines = []; return { out: (s) => lines.push(String(s)), err: (s) => lines.push(String(s)), lines }; }

test('1) --help 正常退出：不读凭据、不联网', async () => {
  let readAuthCalled = false;
  const fetchImpl = countingFetch(() => { throw new Error('不应联网'); });
  const c = cap();
  const code = await run(['--help'], { env: NULL_ENV, stdout: c.out, stderr: c.err, fetchImpl, readAuth: () => { readAuthCalled = true; return { cookie: '', token: '' }; } });
  assert.equal(code, 0);
  assert.equal(fetchImpl.count(), 0);
  assert.equal(readAuthCalled, false);
  assert.match(c.lines.join('\n'), /用法: node src\/client\.mjs/);
});

test('2) 默认模式不联网', async () => {
  const fetchImpl = countingFetch(() => { throw new Error('不应联网'); });
  const c = cap();
  const code = await run([], { env: NULL_ENV, stdout: c.out, stderr: c.err, fetchImpl, readAuth: readAuthFake });
  assert.equal(code, 0);
  assert.equal(fetchImpl.count(), 0);
});

test('3) --dry-run 不联网', async () => {
  const fetchImpl = countingFetch(() => { throw new Error('不应联网'); });
  const c = cap();
  const code = await run(['--dry-run', '--scenario', 'new-conversation', '--text', 'hi'], { env: NULL_ENV, stdout: c.out, stderr: c.err, fetchImpl, readAuth: readAuthFake });
  assert.equal(code, 0);
  assert.equal(fetchImpl.count(), 0);
});

test('4) --dry-run 与 --live 冲突：非零退出码、零网络请求、不读凭据', async () => {
  const fetchImpl = countingFetch(() => { throw new Error('不应联网'); });
  let readAuthCalled = false;
  const c = cap();
  const code = await run(['--dry-run', '--live', '--scenario', 'new-conversation', '--text', 'hi'], {
    env: NULL_ENV, stdout: c.out, stderr: c.err, fetchImpl, readAuth: () => { readAuthCalled = true; throw new Error('不应读取凭据'); },
  });
  assert.notEqual(code, 0);
  assert.equal(code, 2);
  assert.equal(fetchImpl.count(), 0);
  assert.equal(readAuthCalled, false);
  assert.match(c.lines.join('\n'), /不能同时使用/);
});

test('未知参数 / 缺值 / 无效场景 → 退出码 2', async () => {
  const fetchImpl = countingFetch(() => { throw new Error('不应联网'); });
  const mk = () => cap();
  let c = mk();
  assert.equal(await run(['--nope'], { env: NULL_ENV, stdout: c.out, stderr: c.err, fetchImpl, readAuth: readAuthFake }), 2);
  c = mk();
  assert.equal(await run(['--scenario'], { env: NULL_ENV, stdout: c.out, stderr: c.err, fetchImpl, readAuth: readAuthFake }), 2);
  c = mk();
  assert.equal(await run(['--scenario', 'bogus', '--live', '--text', 'x'], { env: NULL_ENV, stdout: c.out, stderr: c.err, fetchImpl, readAuth: readAuthFake }), 2);
  assert.equal(fetchImpl.count(), 0);
});

test('5) 完整合法 SSE：合并回答并成功结束（live 新会话）', async () => {
  const fetchImpl = countingFetch((url) => {
    if (url.endsWith('/api/orbit/v1/chat/new')) return jsonResponse({ code: 0, data: { id: 555 } });
    if (url.endsWith('/api/orbit/v1/chat')) return sseResponse([sseFromEvents(completeEvents({ cid: 555, mid: 7, answer: 'OK' }))]);
    throw new Error('未知 URL ' + url);
  });
  const c = cap();
  const code = await run(['--live', '--scenario', 'new-conversation', '--text', 'INKSTONE-RE-T-01：请只回复 OK。'],
    { env: NULL_ENV, stdout: c.out, stderr: c.err, fetchImpl, readAuth: readAuthFake });
  assert.equal(code, 0);
  assert.equal(fetchImpl.count(), 2);
  const joined = c.lines.join('\n');
  assert.match(joined, /answer="OK"/);
  assert.match(joined, /finished=true/);
});

test('6) 有部分回答但缺正常结束事件 → 失败（非零）', async () => {
  const fetchImpl = countingFetch((url) => {
    if (url.endsWith('/api/orbit/v1/chat/new')) return jsonResponse({ code: 0, data: { id: 556 } });
    if (url.endsWith('/api/orbit/v1/chat')) return sseResponse([sseFromEvents(incompleteEvents({ cid: 556, answer: 'OK' }))]);
    throw new Error('未知 URL');
  });
  const c = cap();
  const code = await run(['--live', '--scenario', 'new-conversation', '--text', 'x'], { env: NULL_ENV, stdout: c.out, stderr: c.err, fetchImpl, readAuth: readAuthFake });
  assert.notEqual(code, 0);
  assert.match(c.lines.join('\n'), /缺少 workflow_finished|未正常结束/);
});

test('7) HTTP 200 业务错误 JSON → 失败（非零）', async () => {
  const fetchImpl = countingFetch((url) => {
    if (url.endsWith('/api/orbit/v1/chat/new')) return jsonResponse({ code: 0, data: { id: 557 } });
    if (url.endsWith('/api/orbit/v1/chat')) return jsonResponse({ code: -10002, message: 'nope' }); // 200 + JSON
    throw new Error('未知 URL');
  });
  const c = cap();
  const code = await run(['--live', '--scenario', 'new-conversation', '--text', 'x'], { env: NULL_ENV, stdout: c.out, stderr: c.err, fetchImpl, readAuth: readAuthFake });
  assert.notEqual(code, 0);
  assert.match(c.lines.join('\n'), /不是 SSE|Content-Type/);
});

test('7b) chat/new 业务失败 → 失败（非零）', async () => {
  const fetchImpl = countingFetch(() => jsonResponse({ code: -1 }));
  const c = cap();
  const code = await run(['--live', '--scenario', 'new-conversation', '--text', 'x'], { env: NULL_ENV, stdout: c.out, stderr: c.err, fetchImpl, readAuth: readAuthFake });
  assert.notEqual(code, 0);
  assert.match(c.lines.join('\n'), /chat\/new 业务失败/);
});

test('8) HTTP 非成功状态 → 失败（非零）', async () => {
  const fetchImpl = countingFetch((url) => {
    if (url.endsWith('/api/orbit/v1/chat/new')) return jsonResponse({ code: 0, data: { id: 558 } });
    if (url.endsWith('/api/orbit/v1/chat')) return jsonResponse({ message: 'server error' }, { status: 500 });
    throw new Error('未知 URL');
  });
  const c = cap();
  const code = await run(['--live', '--scenario', 'new-conversation', '--text', 'x'], { env: NULL_ENV, stdout: c.out, stderr: c.err, fetchImpl, readAuth: readAuthFake });
  assert.notEqual(code, 0);
  assert.match(c.lines.join('\n'), /HTTP 500/);
});

test('fixture 离线：完整样本成功，不完整样本失败', async () => {
  const c1 = cap();
  assert.equal(await run(['--dry-run', '--fixture', 'fixtures/first-turn.json'], { env: NULL_ENV, stdout: c1.out, stderr: c1.err }), 0);
  const c2 = cap();
  // 用一个不完整样本文件
  const tmp = 'tests/tmp-incomplete.sse.txt';
  const { writeFileSync, unlinkSync } = await import('node:fs');
  writeFileSync(tmp, sseFromEvents(incompleteEvents()));
  assert.notEqual(await run(['--dry-run', '--fixture', tmp], { env: NULL_ENV, stdout: c2.out, stderr: c2.err }), 0);
  unlinkSync(tmp);
});
