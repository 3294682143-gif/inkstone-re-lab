// src/desktop/gateway-events.mjs
// 桌面端 cloud gateway 推理事件（SSE `type` 协议）解析与序列校验。
// 依据：0.2.7 主 bundle 静态确认（out/main/index-CYl10ENn.js:38554 起 GatewayEventSequence / parseGatewayEvent）。
// 与 Web 的 `event` 协议不同：桌面用 `type`；正常结束是 `message_end`（其前必须出现 `usage`）。
// 纯 Node 模块：不 import electron、不 import 解包后的主 bundle。

export const EVENT_TYPES = Object.freeze([
  'message_start', 'thinking_delta', 'content_delta',
  'tool_use_start', 'tool_input_delta', 'tool_use_end',
  'usage', 'message_end', 'error',
]);

export const STOP_REASONS = Object.freeze(['end_turn', 'tool_use', 'max_tokens', 'stop_sequence']);
export const USAGE_KEYS = Object.freeze(['input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens']);

export class GatewayProtocolError extends Error {
  constructor(message, { kind = 'protocol' } = {}) { super(message); this.name = 'GatewayProtocolError'; this.kind = kind; }
}

const isRecord = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNonNegInt = (v) => Number.isInteger(v) && v >= 0;
const bounded = (v, max) => typeof v === 'string' && Buffer.byteLength(v, 'utf8') <= max;

function exactKeys(obj, keys, optional = []) {
  const opt = new Set(optional);
  const required = keys.filter((k) => !opt.has(k));
  const allowed = new Set(keys);
  const actual = Object.keys(obj);
  if (actual.some((k) => !allowed.has(k)) || required.some((k) => !(k in obj))) {
    throw new GatewayProtocolError('event keys do not match schema');
  }
}

/** 把一帧 `data:` 文本解析为受校验的事件对象。 */
export function parseGatewayEvent(source) {
  if (typeof source !== 'string' || Buffer.byteLength(source, 'utf8') > 4 * 1024 * 1024) {
    throw new GatewayProtocolError('event too large or not a string');
  }
  let parsed;
  try { parsed = JSON.parse(source); } catch { throw new GatewayProtocolError('event is not valid JSON'); }
  const event = parsed;
  if (!isRecord(event) || typeof event.type !== 'string') throw new GatewayProtocolError('event has no type');
  switch (event.type) {
    case 'message_start':
      exactKeys(event, ['type', 'response_id', 'model']);
      if (!bounded(event.response_id, 200) || !bounded(event.model, 200)) throw new GatewayProtocolError('message_start fields invalid');
      break;
    case 'thinking_delta':
    case 'content_delta':
      exactKeys(event, ['type', 'text']);
      if (typeof event.text !== 'string') throw new GatewayProtocolError('delta text invalid');
      break;
    case 'tool_use_start':
      exactKeys(event, ['type', 'id', 'name']);
      if (!bounded(event.id, 200) || !bounded(event.name, 120)) throw new GatewayProtocolError('tool_use_start fields invalid');
      break;
    case 'tool_input_delta':
      exactKeys(event, ['type', 'id', 'partial_json']);
      if (!bounded(event.id, 200) || typeof event.partial_json !== 'string') throw new GatewayProtocolError('tool_input_delta fields invalid');
      break;
    case 'tool_use_end':
      exactKeys(event, ['type', 'id', 'input'], ['input']);
      if (!bounded(event.id, 200) || (event.input !== undefined && !isRecord(event.input))) throw new GatewayProtocolError('tool_use_end fields invalid');
      break;
    case 'usage': {
      exactKeys(event, ['type', 'usage']);
      const u = event.usage;
      if (!isRecord(u)) throw new GatewayProtocolError('usage invalid');
      exactKeys(u, ['input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens'], ['cache_read_tokens', 'cache_write_tokens']);
      if (!isNonNegInt(u.input_tokens) || !isNonNegInt(u.output_tokens)) throw new GatewayProtocolError('usage tokens invalid');
      for (const k of ['cache_read_tokens', 'cache_write_tokens']) if (u[k] !== undefined && !isNonNegInt(u[k])) throw new GatewayProtocolError('usage cache tokens invalid');
      break;
    }
    case 'message_end':
      exactKeys(event, ['type', 'stop_reason']);
      if (!STOP_REASONS.includes(String(event.stop_reason))) throw new GatewayProtocolError('stop_reason invalid');
      break;
    case 'error':
      exactKeys(event, ['type', 'code', 'message', 'retryable']);
      if (!bounded(event.code, 120) || !bounded(event.message, 2000) || typeof event.retryable !== 'boolean') throw new GatewayProtocolError('error fields invalid');
      break;
    default:
      throw new GatewayProtocolError('unsupported event type: ' + event.type);
  }
  return event;
}

/**
 * 序列校验（与打包代码一致）：
 * 必须以 message_start 开始；usage 至多一次；usage 之后只允许 message_end；
 * message_end 之前必须有 usage；error 视为终止；结束后不得再有事件。
 */
export class GatewayEventSequence {
  constructor(maxEvents = 100000) { this.started = false; this.usage = false; this.terminal = false; this.count = 0; this.maxEvents = maxEvents; }
  accept(event) {
    this.count += 1;
    if (this.count > this.maxEvents || this.terminal) throw new GatewayProtocolError('event sequence is invalid');
    if (!this.started && event.type !== 'message_start') throw new GatewayProtocolError('stream did not start with message_start');
    if (event.type === 'message_start') { if (this.started) throw new GatewayProtocolError('duplicate message_start'); this.started = true; return; }
    if (event.type === 'usage') { if (this.usage) throw new GatewayProtocolError('duplicate usage'); this.usage = true; return; }
    if (this.usage && event.type !== 'message_end') throw new GatewayProtocolError('unexpected event after usage');
    if (event.type === 'message_end') { if (!this.usage) throw new GatewayProtocolError('message_end preceded usage'); this.terminal = true; }
    else if (event.type === 'error') this.terminal = true;
  }
  finish() { if (!this.started || !this.terminal) throw new GatewayProtocolError('stream ended without a terminal event'); }
}

/** 累积回答文本、思考文本、工具调用与 usage。 */
export class GatewayStreamMerger {
  constructor() { this.reset(); }
  reset() {
    this.responseId = null; this.model = null;
    this.thinking = ''; this.content = '';
    this.tools = new Map(); this.toolOrder = [];
    this.usage = null; this.stopReason = null; this.error = null;
    this.terminal = false; this.events = 0;
  }
  apply(event) {
    this.events += 1;
    const seq = this._seq ?? (this._seq = new GatewayEventSequence());
    seq.accept(event);
    switch (event.type) {
      case 'message_start': this.responseId = event.response_id; this.model = event.model; break;
      case 'thinking_delta': this.thinking += event.text; break;
      case 'content_delta': this.content += event.text; break;
      case 'tool_use_start': this.tools.set(event.id, { id: event.id, name: event.name, inputJson: '', input: undefined }); this.toolOrder.push(event.id); break;
      case 'tool_input_delta': { const t = this.tools.get(event.id) ?? { id: event.id, name: null, inputJson: '', input: undefined }; t.inputJson += event.partial_json; this.tools.set(event.id, t); if (!this.toolOrder.includes(event.id)) this.toolOrder.push(event.id); break; }
      case 'tool_use_end': { const t = this.tools.get(event.id) ?? { id: event.id, name: null, inputJson: '', input: undefined }; t.input = event.input; this.tools.set(event.id, t); break; }
      case 'usage': this.usage = { ...event.usage }; break;
      case 'message_end': this.stopReason = event.stop_reason; this.terminal = true; break;
      case 'error': this.error = { code: event.code, message: event.message, retryable: event.retryable }; this.terminal = true; break;
    }
    return this;
  }
  finish() { this._seq?.finish(); }
}

/**
 * UTF-8 流式 SSE 分帧：把字节块切成 `data:` 负载字符串（不做 JSON 解析）。
 * 复用与 Web 解析器相同的分帧/解码思路，但保留原始负载交给 parseGatewayEvent 校验。
 */
export class GatewaySSEFramer {
  constructor() { this._dec = new TextDecoder('utf-8'); this._buf = ''; }
  push(chunk) {
    this._buf += (typeof chunk === 'string') ? chunk : this._dec.decode(chunk, { stream: true });
    const out = [];
    const norm = this._buf.replace(/\r\n/g, '\n');
    const parts = norm.split('\n\n');
    this._buf = parts.pop() ?? '';
    for (const block of parts) { const d = this._data(block); if (d !== null) out.push(d); }
    return out;
  }
  flush() { this._buf += this._dec.decode(); const d = this._data(this._buf); this._buf = ''; return d === null ? [] : [d]; }
  _data(block) {
    let data = null;
    for (const raw of block.split('\n')) {
      const line = raw.replace(/\r$/, '');
      if (line === '' || line.startsWith(':')) continue;
      if (line.startsWith('data:')) data = (data === null ? '' : data + '\n') + line.slice(5).replace(/^ /, '');
    }
    return data;
  }
}
