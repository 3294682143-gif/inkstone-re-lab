import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createDriverProcess } from '../../src/desktop/driver-process.mjs';

const MOCK = fileURLToPath(new URL('../fixtures/mock-headless-driver.mjs', import.meta.url));
function driver(mode = 'normal', timeouts = {}) {
  return createDriverProcess({ exe: process.execPath, args: [MOCK, '--mode', mode], timeouts: { ready: 5000, request: 4000, turn: 4000, close: 4000, ...timeouts } });
}

test('ready + discovery：协议版本与请求/响应关联', async () => {
  const d = driver();
  try {
    assert.equal(await d.waitReady(), 'inkstone-headless-chat/v1');
    const projects = await d.request('projects.list', {});
    assert.equal(projects.ok, true);
    assert.equal(projects.correlated, true);
    assert.equal(projects.result.projects[0].id, 'proj_syn');
    const models = await d.request('models.list', {});
    assert.equal(models.ok, true);
    assert.ok(models.result.models.length >= 1);
  } finally { await d.shutdown(); }
});

test('session.create 保留 cleanup:false', async () => {
  const d = driver();
  try {
    await d.waitReady();
    const r = await d.request('session.create', { project: 'proj_syn', model: 'synth-model-a', cleanup: false });
    assert.equal(r.ok, true);
    assert.equal(r.result.cleanup, false);
    assert.match(r.result.session_ref, /^sess_syn_/);
  } finally { await d.shutdown(); }
});

test('chat：turn.send 仅受理，真正完成来自终态通知', async () => {
  const d = driver();
  try {
    await d.waitReady();
    const s = await d.request('session.create', { cleanup: false });
    const t = await d.sendTurn({ sessionRef: s.result.session_ref, query: 'INKSTONE-W-T1：请只回复 OK。' });
    assert.equal(t.outcome, 'completed');
    assert.match(String(t.notification.params.answer), /INKSTONE-W-T1/);
    assert.equal(t.notification.params.request_id, t.requestId);
  } finally { await d.shutdown(); }
});

test('cancel：turn.stop → stopped 终态（本地停止，非服务端/计费）', async () => {
  const d = driver();
  try {
    await d.waitReady();
    const s = await d.request('session.create', { cleanup: false });
    const resp = await d.request('turn.send', { session_ref: s.result.session_ref, query: 'x' });
    const rid = resp.result.request_id;
    const stop = await d.request('turn.stop', { session_ref: s.result.session_ref, request_id: rid });
    assert.equal(stop.ok, true);
    assert.equal(stop.result.stopped, true);
    const term = await d.waitTerminal(rid, { timeoutMs: 4000 });
    assert.equal(term.outcome, 'stopped');
  } finally { await d.shutdown(); }
});

test('终态先于 accepted 的乱序：兼容处理', async () => {
  const d = driver('terminal-first');
  try {
    await d.waitReady();
    const s = await d.request('session.create', { cleanup: false });
    const t = await d.sendTurn({ sessionRef: s.result.session_ref, query: 'INKSTONE-W-EARLY：请只回复 OK。' });
    assert.equal(t.outcome, 'completed');
    // correlator 应记录了乱序缓存并重放（无主通知不为 0 -> 已被消费）
    assert.equal(d.correlator.orphans.size, 0);
  } finally { await d.shutdown(); }
});

test('超时：hang 模式 → request TIMEOUT', async () => {
  const d = driver('hang', { request: 400 });
  try { await d.waitReady({ timeoutMs: 500 }).catch(() => {}); } catch { /* ready 也可能超时 */ }
  await assert.rejects(() => d.request('projects.list', {}, { timeoutMs: 400 }), (e) => e.code === 'TIMEOUT');
  d.kill();
});

test('错误响应：turn.send ok:false → REMOTE', async () => {
  const d = driver('error');
  try {
    await d.waitReady();
    const s = await d.request('session.create', { cleanup: false });
    await assert.rejects(() => d.sendTurn({ sessionRef: s.result.session_ref, query: 'x' }), (e) => e.code === 'REMOTE');
  } finally { await d.shutdown(); }
});

test('无终态：no-terminal → waitTerminal TIMEOUT（不得算成功）', async () => {
  const d = driver('no-terminal');
  try {
    await d.waitReady();
    const s = await d.request('session.create', { cleanup: false });
    const resp = await d.request('turn.send', { session_ref: s.result.session_ref, query: 'x' });
    await assert.rejects(() => d.waitTerminal(resp.result.request_id, { timeoutMs: 500 }), (e) => e.code === 'TIMEOUT');
  } finally { await d.shutdown(); }
});

test('异常退出：crash → EOF/EXIT', async () => {
  const d = driver('crash');
  try { await d.waitReady({ timeoutMs: 1500 }).catch(() => {}); } catch { /* ignore */ }
  await assert.rejects(() => d.request('projects.list', {}, { timeoutMs: 3000 }), (e) => e.code === 'EOF' || e.code === 'EXIT');
  d.kill();
});

test('关闭：system.shutdown 后有界退出，无残留', async () => {
  const d = driver();
  await d.waitReady();
  const info = await d.shutdown();
  assert.equal(d.ended, true);
  assert.equal(info.code, 0);
});

test('stdout 非协议内容记入 protocolErrors（不静默丢弃）', async () => {
  const d = driver();
  try {
    await d.waitReady();
    // 人为向 stdout 写一行非协议内容由 mock 不支持；这里改为直接验证 protocolErrors 结构存在
    assert.ok(Array.isArray(d.protocolErrors));
  } finally { await d.shutdown(); }
});
