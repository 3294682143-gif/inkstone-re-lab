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
 * 关联器：发送请求、按 id 关联响应，并把 turn.send 的 accepted 与真正完成区分开。
 * - turn.send 的响应 result.accepted === true 只代表“已受理”。
 * - 真正完成来自异步通知 turn.completed / turn.failed（按 session_ref/request_id 关联）。
 */
export class DriverCorrelator {
  constructor() { this.pending = new Map(); this.responses = new Map(); this.notifications = []; this.turnStates = new Map(); this.ready = null; this._seq = 0; }
  nextId(prefix = 'req') { return `${prefix}-${++this._seq}`; }
  request(method, params = {}, prefix) { const id = this.nextId(prefix); this.pending.set(id, { method, params }); return { id, method, params }; }
  /** 喂入一行输出；返回一个分类结果。 */
  handleLine(line) {
    const msg = parseMessage(line);
    if (msg.kind === 'notification') {
      this.notifications.push(msg);
      if (msg.method === 'driver.ready') this.ready = msg.params?.protocol_version ?? null;
      if (msg.method === 'turn.completed' || msg.method === 'turn.failed') {
        const key = msg.params?.request_id ?? msg.params?.session_ref;
        if (key) this.turnStates.set(String(key), msg.method === 'turn.completed' ? 'completed' : 'failed');
      }
      return msg;
    }
    this.pending.delete(msg.id);
    this.responses.set(msg.id, msg);
    return msg;
  }
  /** turn.send 的响应是否“已受理”（不代表完成）。 */
  static isAccepted(response) { return response?.kind === 'response' && response.ok === true && response.result?.accepted === true; }
  /** 用 request_id 或 session_ref 判定该轮是否已到达终态。 */
  turnOutcome(key) { return this.turnStates.get(String(key)) ?? 'pending'; }
  isReady() { return this.ready === HEADLESS_CHAT_PROTOCOL_VERSION; }
}
