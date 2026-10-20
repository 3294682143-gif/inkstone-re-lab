// src/desktop/driver-process.mjs
// 子进程 JSONL 传输层：spawn 正式 headless driver（或 mock），复用 JsonlFramer / DriverCorrelator。
// - 参数数组 spawn，shell:false；stdin 只写 {id,method,params}；stdout/stderr 分开处理。
// - 支持任意分块/跨 UTF-8 字节/多行同块/末尾半行（由 JsonlFramer 处理）。
// - 校验 driver.ready 协议版本；响应与原请求严格关联；accepted 仅代表受理。
// - 超时（ready/请求/回合/关闭）；EOF、非零退出、异常 JSONL、错误响应均有明确结果。
// - stdout 非协议内容记入 protocolErrors，不静默丢弃并继续报成功。
import { spawn } from 'node:child_process';
import { JsonlFramer, parseMessage, encodeRequest, DriverCorrelator, HEADLESS_CHAT_PROTOCOL_VERSION } from './driver-jsonl.mjs';

export class DriverProcessError extends Error {
  constructor(message, { code = 'DRIVER_ERROR' } = {}) { super(message); this.name = 'DriverProcessError'; this.code = code; }
}

const DEFAULTS = { ready: 30000, request: 30000, turn: 120000, close: 10000 };

export function createDriverProcess({ exe, args = ['--headless-chat-driver'], env = process.env, cwd, spawnImpl = spawn, timeouts = {}, log = () => {} } = {}) {
  if (!exe) throw new DriverProcessError('exe is required', { code: 'ARGS' });
  const T = { ...DEFAULTS, ...timeouts };
  const correlator = new DriverCorrelator();
  const framer = new JsonlFramer();
  const pending = new Map();            // jsonl id -> {resolve,reject,timer}
  const notifications = [];
  const protocolErrors = [];
  const stderrChunks = [];
  const waiters = [];                   // {predicate,resolve,timer}
  let child = null; let exitInfo = null; let exitPromise = null; let seq = 0; let ended = false;

  function notifyWaiters() {
    for (let i = waiters.length - 1; i >= 0; i--) {
      try { if (waiters[i].predicate()) { const w = waiters.splice(i, 1)[0]; clearTimeout(w.timer); w.resolve(); } } catch { /* ignore */ }
    }
  }
  function rejectAll(err) { for (const [, p] of pending) { clearTimeout(p.timer); p.reject(err); } pending.clear(); notifyWaiters(); }

  function handleLine(line) {
    let ret;
    try { ret = correlator.handleLine(line); }
    catch (e) { protocolErrors.push({ line: String(line).slice(0, 160), error: String(e.message || e) }); return; }
    if (!ret) { protocolErrors.push({ line: String(line).slice(0, 160), error: 'no parse result' }); return; }
    if (ret.kind === 'notification') { notifications.push(ret); notifyWaiters(); return; }
    const p = pending.get(ret.id);
    if (p) { clearTimeout(p.timer); pending.delete(ret.id); p.resolve(ret); }
    else { protocolErrors.push({ line: String(line).slice(0, 160), error: 'response for unknown id ' + ret.id }); }
    notifyWaiters();
  }

  function start() {
    if (child) return child;
    log(`spawn ${exe} ${args.join(' ')}`);
    child = spawnImpl(exe, args, { cwd, env, shell: false, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    exitPromise = new Promise((resolve) => child.once('exit', (code, signal) => { exitInfo = { code, signal }; resolve(exitInfo); }));
    child.stdout.setEncoding?.('utf8');
    child.stdout.on('data', (buf) => { for (const l of framer.push(buf)) handleLine(l); });
    child.stdout.on('end', () => { ended = true; for (const l of framer.flush()) handleLine(l); rejectAll(new DriverProcessError('driver stdout ended (EOF)', { code: 'EOF' })); });
    child.stderr.on('data', (b) => stderrChunks.push(Buffer.from(b)));
    child.on('error', (e) => { ended = true; rejectAll(e); });
    child.once('exit', () => { ended = true; rejectAll(new DriverProcessError('driver exited', { code: 'EXIT' })); notifyWaiters(); });
    return child;
  }

  function waitFor(predicate, timeoutMs, label) {
    if (predicate()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { const i = waiters.findIndex((w) => w.timer === timer); if (i >= 0) waiters.splice(i, 1); reject(new DriverProcessError(`${label} timed out`, { code: 'TIMEOUT' })); }, timeoutMs);
      const w = { predicate, timer, resolve: () => { clearTimeout(timer); resolve(); } };
      waiters.push(w);
      if (ended && !predicate()) { clearTimeout(timer); const i = waiters.indexOf(w); if (i >= 0) waiters.splice(i, 1); reject(new DriverProcessError('driver already exited', { code: 'EOF' })); }
    });
  }

  function request(method, params = {}, { timeoutMs = T.request } = {}) {
    start();
    if (ended) return Promise.reject(new DriverProcessError('driver already exited', { code: 'EOF' }));
    const req = correlator.request(method, params, 'req');   // 复用严格关联器生成 id 并登记
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(req.id); reject(new DriverProcessError(`request ${method} timed out`, { code: 'TIMEOUT' })); }, timeoutMs);
      pending.set(req.id, { resolve, reject, timer });
      try { child.stdin.write(encodeRequest(req)); }
      catch (e) { clearTimeout(timer); pending.delete(req.id); reject(e); }
    });
  }

  async function waitReady({ timeoutMs = T.ready } = {}) {
    start();
    await waitFor(() => correlator.isReady(), timeoutMs, 'driver.ready');
    return correlator.ready;
  }

  /** turn.send → accepted（可能先/后到）→ 等待该 request_id 的终态。 */
  async function sendTurn({ sessionRef, query, timeoutMs = T.turn } = {}) {
    const resp = await request('turn.send', { session_ref: sessionRef, query });
    if (!resp.ok) throw new DriverProcessError(`turn.send rejected: ${resp.error?.code}`, { code: 'REMOTE' });
    const result = resp.result || {};
    const requestId = result.request_id;
    if (result.accepted !== true || typeof requestId !== 'string') throw new DriverProcessError('turn.send not accepted', { code: 'PROTOCOL' });
    const terminal = await waitTerminal(requestId, { timeoutMs });
    return { requestId, sessionRef: result.session_ref ?? sessionRef, outcome: terminal.outcome, notification: terminal.notification };
  }

  function waitTerminal(requestId, { timeoutMs = T.turn } = {}) {
    return waitFor(() => correlator.isTerminal(requestId), timeoutMs, `turn ${requestId} terminal`).then(() => {
      const outcome = correlator.turnOutcome(requestId);
      const notification = notifications.filter((n) => (n.params?.request_id === requestId)).slice(-1)[0] ?? null;
      return { outcome, notification };
    });
  }

  async function shutdown({ timeoutMs = T.close } = {}) {
    start();
    try { await request('system.shutdown', {}, { timeoutMs: T.request }); } catch (e) { log('shutdown request: ' + e.message); }
    if (!ended) {
      const raced = await Promise.race([exitPromise, new Promise((r) => setTimeout(() => r(null), timeoutMs))]);
      if (raced === null) { log('driver did not exit in time; killing'); try { child.kill(); } catch { /* ignore */ } await Promise.race([exitPromise, new Promise((r) => setTimeout(r, 3000))]); }
    }
    return exitInfo;
  }
  function kill() { try { child?.kill(); } catch { /* ignore */ } }

  return {
    start, request, waitReady, sendTurn, waitTerminal, shutdown, kill,
    get correlator() { return correlator; },
    get notifications() { return notifications; },
    get protocolErrors() { return protocolErrors; },
    get stderrText() { return Buffer.concat(stderrChunks).toString('utf8'); },
    get exitInfo() { return exitInfo; },
    get ended() { return ended; },
    get pid() { return child?.pid ?? null; },
    PROTOCOL_VERSION: HEADLESS_CHAT_PROTOCOL_VERSION,
  };
}
