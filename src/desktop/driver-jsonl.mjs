// src/desktop/driver-jsonl.mjs
// 桌面 headless driver 的 JSON Lines 协议解析 / 请求-响应关联 / 异步收尾识别。
// 依据：0.2.7 主 bundle 静态确认（out/main/index-CYl10ENn.js:118351 起 HeadlessChatDriver、:118833 parseRequest）。
// 纯 Node 模块：不 spawn 任何进程；真实启动器在别处，由调用方注入。

export const HEADLESS_CHAT_PROTOCOL_VERSION = 'inkstone-headless-chat/v1';
export const HEADLESS_METHODS = Object.freeze([
  'projects.list', 'models.list',
  'session.create', 'session.open', 'session.inspect', 'session.close',
  'turn.send', 'turn.stop',
  'history.get',
  'approval.list', 'approval.respond',
  'system.shutdown',
]);
// 通知（无 id）
export const NOTIFICATIONS = Object.freeze(['driver.ready', 'turn.completed', 'turn.failed', 'cleanup.warning']);

export class DriverProtocolError extends Error {
  constructor(message, { code = 'HEADLESS_INVALID_REQUEST' } = {}) { super(message); this.name = 'DriverProtocolError'; this.code = code; }
}

const isRecord = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/** UTF-8 流式 JSONL 分帧：任意分块、跨字节、合并多行。 */
export class JsonlFramer {
  constructor() { this._dec = new TextDecoder('utf-8'); this._buf = ''; }
  push(chunk) {
    this._buf += (typeof chunk === 'string') ? chunk : this._dec.decode(chunk, { stream: true });
    const lines = [];
    let idx;
    while ((idx = this._buf.indexOf('\n')) >= 0) {
      const line = this._buf.slice(0, idx).replace(/\r$/, '');
      this._buf = this._buf.slice(idx + 1);
      if (line.trim() !== '') lines.push(line);
    }
    return lines;
  }
  flush() {
    this._buf += this._dec.decode();
    const tail = this._buf.trim();
    this._buf = '';
    return tail ? [tail] : [];
  }
}

/** 解析一条请求（严格：仅 id/method/params）。 */
export function parseRequestLine(line) {
  let value;
  try { value = JSON.parse(line); } catch { throw new DriverProtocolError('request is not valid JSON', { code: 'HEADLESS_INVALID_JSON' }); }
  if (!isRecord(value)) throw new DriverProtocolError('request must be an object');
  const keys = Object.keys(value);
  if (keys.some((k) => !['id', 'method', 'params'].includes(k)) ||
      !('id' in value) || !('method' in value)) {
    throw new DriverProtocolError('request keys must be exactly id/method/params');
  }
  const { id, method } = value;
  if (typeof id !== 'string' || id.length === 0 || id.length > 128) throw new DriverProtocolError('request id invalid');
  if (typeof method !== 'string' || method.length === 0 || method.length > 128) throw new DriverProtocolError('request method invalid');
  const params = value.params ?? {};
  if (!isRecord(params)) throw new DriverProtocolError('params must be an object', { code: 'HEADLESS_INVALID_PARAMS' });
  return { id, method, params };
}

/** 构造一条请求行（不含 jsonrpc 字段）。 */
export function encodeRequest(request) {
  const { id, method, params = {} } = request;
  return JSON.stringify({ id, method, params }) + '\n';
}

/** 解析一行输出消息：响应 {id,ok,result|error} 或通知 {method,params}。 */
export function parseMessage(line) {
  let value;
  try { value = JSON.parse(line); } catch { throw new DriverProtocolError('output line is not valid JSON', { code: 'HEADLESS_INVALID_JSON' }); }
  if (!isRecord(value)) throw new DriverProtocolError('output message must be an object');
  if ('method' in value) {
    const method = value.method;
    if (typeof method !== 'string') throw new DriverProtocolError('notification method invalid');
    return { kind: 'notification', method, params: isRecord(value.params) ? value.params : {} };
  }
  if ('id' in value) {
    const ok = value.ok;
    if (typeof ok !== 'boolean') throw new DriverProtocolError('response ok flag invalid');
    if (ok) return { kind: 'response', id: value.id, ok: true, result: value.result };
    return { kind: 'response', id: value.id, ok: false, error: isRecord(value.error) ? value.error : { code: 'UNKNOWN', message: 'error' } };
  }
  throw new DriverProtocolError('unrecognized output message');
}

/**
 * 合法 turn 状态（静态证据：`turnStatus()` 仅接受下值，见 06-desktop/contracts/cloud-gateway.md）。
 * 终态映射：complete→completed（成功）；stopped→stopped；error→failed；running→仍 pending；其它/缺失→unknown（不算成功）。
 */
export const TURN_STATUSES = Object.freeze(['running', 'complete', 'stopped', 'error']);
export const TURN_OUTCOMES = Object.freeze(['pending', 'completed', 'stopped', 'failed', 'unknown']);

function terminalOutcome(method, status) {
  if (method === 'turn.failed') return 'failed';
  switch (status) {
    case 'complete': return 'completed';
    case 'stopped': return 'stopped';
    case 'error': return 'failed';
    case 'running': return null;   // 非终态，保持 pending
    default: return 'unknown';     // 缺失或未知状态：终态但非成功
  }
}

/**
 * 关联器：发送请求（JSONL `id`）→ 关联响应；并把 `turn.send` 的 accepted（回合 `request_id`）
 * 与异步终态通知 `turn.completed`/`turn.failed` 区分开。
 *
 * 关键点：
 * - JSONL 请求 `id` 与回合 `request_id` 是不同标识，分别用于响应关联与本回合终态。
 * - 只有已登记（来自 accepted 响应）的回合才会被通知影响；未知/重复/跨会话/过期的通知不污染已有任务。
 * - 若终态通知先于 accepted 响应到达（协议允许的乱序），有限缓存并在登记后重放；缓存有上限。
 * - 终态一经确定不被后续事件覆盖（terminate-once）。
 */
export class DriverCorrelator {
  constructor({ orphanLimit = 64 } = {}) {
    this.pending = new Map();       // jsonl id -> {method, params}
    this.responses = new Map();     // jsonl id -> correlated response
    this.notifications = [];
    this.turns = new Map();         // request_id -> {sessionRef, turnId, outcome, status, terminal}
    this.unmatched = [];            // 未关联/重复/跨会话等，单独保存
    this.orphans = new Map();       // request_id -> 先到的终态通知（有界）
    this.orphanLimit = orphanLimit;
    this.ready = null;
    this._seq = 0;
  }
  nextId(prefix = 'req') { return `${prefix}-${++this._seq}`; }
  request(method, params = {}, prefix) { const id = this.nextId(prefix); this.pending.set(id, { method, params }); return { id, method, params }; }

  /** 喂入一行输出；返回分类结果（响应带 correlated 标记；通知原样）。 */
  handleLine(line) {
    const msg = parseMessage(line);
    return msg.kind === 'notification' ? this._handleNotification(msg) : this._handleResponse(msg);
  }

  _handleResponse(msg) {
    const req = this.pending.get(msg.id);
    if (!req) {                                  // 未知 / 重复 / 过期响应：不落 responses
      const rec = { ...msg, correlated: false, reason: 'unknown-response-id' };
      this.unmatched.push(rec);
      return rec;
    }
    this.pending.delete(msg.id);
    const correlated = { ...msg, request: req, correlated: true };
    this.responses.set(msg.id, correlated);
    // accepted 的 turn.send：登记回合（request_id），并重放可能先到的终态通知
    if (correlated.ok && isRecord(msg.result) && msg.result.accepted === true && typeof msg.result.request_id === 'string') {
      this._registerTurn(msg.result.request_id, msg.result.session_ref);
    }
    return correlated;
  }

  _registerTurn(requestId, sessionRef) {
    if (!this.turns.has(requestId)) {
      this.turns.set(requestId, { sessionRef: sessionRef ?? null, turnId: null, outcome: 'pending', status: null, terminal: false });
    }
    const buffered = this.orphans.get(requestId);
    if (buffered) { this.orphans.delete(requestId); this._applyTerminal(buffered); }
  }

  _handleNotification(msg) {
    this.notifications.push(msg);
    if (msg.method === 'driver.ready') { this.ready = msg.params?.protocol_version ?? null; return msg; }
    if (msg.method === 'turn.completed' || msg.method === 'turn.failed') { this._terminalNotification(msg); }
    return msg;
  }

  _terminalNotification(msg) {
    const requestId = msg.params?.request_id;
    if (typeof requestId !== 'string' || requestId.length === 0) {
      this.unmatched.push({ ...msg, reason: 'terminal-without-request-id' });
      return;                                     // 无法安全关联，不污染任何回合
    }
    if (!this.turns.has(requestId)) {             // 终态先于 accepted：有界缓存，登记后重放
      this.orphans.delete(requestId);
      this.orphans.set(requestId, msg);
      while (this.orphans.size > this.orphanLimit) this.orphans.delete(this.orphans.keys().next().value);
      return;
    }
    this._applyTerminal(msg);
  }

  _applyTerminal(msg) {
    const requestId = msg.params?.request_id;
    const turn = this.turns.get(requestId);
    if (!turn) return;
    const sessionRef = msg.params?.session_ref;
    if (turn.sessionRef != null && sessionRef != null && String(sessionRef) !== String(turn.sessionRef)) {
      this.unmatched.push({ ...msg, reason: 'session-mismatch' });   // 跨会话/串扰：忽略
      return;
    }
    if (turn.terminal) { this.unmatched.push({ ...msg, reason: 'already-terminal' }); return; }  // 终态不被覆盖
    const outcome = terminalOutcome(msg.method, msg.params?.status);
    if (typeof msg.params?.turn_id === 'string') turn.turnId = msg.params.turn_id;
    if (outcome === null) { turn.status = msg.params?.status ?? null; return; }   // running：仍 pending
    turn.outcome = outcome;
    turn.status = msg.method === 'turn.failed' ? 'failed' : (msg.params?.status ?? null);
    turn.terminal = true;
  }

  /** turn.send 的响应是否“已受理”（不代表完成）。 */
  static isAccepted(response) {
    const r = response?.correlated ? response : response;
    return r?.kind === 'response' && r.ok === true && isRecord(r.result) && r.result.accepted === true;
  }
  /** 按回合 request_id 判定终态（pending/completed/stopped/failed/unknown）。 */
  turnOutcome(requestId) { return this.turns.get(String(requestId))?.outcome ?? 'pending'; }
  /** 是否有已登记且已到达终态的回合。 */
  isTerminal(requestId) { return this.turns.get(String(requestId))?.terminal === true; }
  isReady() { return this.ready === HEADLESS_CHAT_PROTOCOL_VERSION; }
}
