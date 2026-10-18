// src/desktop/cloud-adapter.mjs
// 桌面端 cloud gateway 纯 Node HTTP adapter（可注入 fetch），仅实现已静态确认的请求结构与校验。
// 依据：0.2.7 主 bundle 静态确认（/chat/new scenario:2、/local-agent/models、/local-agent/messages、
//      /chat/{id}/local-turns[|/{turnId}/checkpoint|/complete]、headers()、requestJsonURL 的 credentials:"omit"、
//      以及 conversationStart/Checkpoint/Complete 的字段校验与 turnStatus() 枚举）。
// 不 import electron；默认不联网（fetchImpl 可注入）。

import { parseCapabilities } from './models-contract.mjs';
import { parseGatewayEvent, GatewayEventSequence, GatewayStreamMerger, GatewaySSEFramer, GatewayProtocolError } from './gateway-events.mjs';

export const DESKTOP_PATHS = Object.freeze({
  newConversation: '/chat/new',
  models: '/local-agent/models',
  messages: '/local-agent/messages',
  localTurns: (chatId) => `/chat/${chatId}/local-turns`,
  localTurnCheckpoint: (chatId, turnId) => `/chat/${chatId}/local-turns/${encodeURIComponent(turnId)}/checkpoint`,
  localTurnComplete: (chatId, turnId) => `/chat/${chatId}/local-turns/${encodeURIComponent(turnId)}/complete`,
});

export const TURN_STATUSES = Object.freeze(['running', 'complete', 'stopped', 'error']);
export const USAGE_FIELDS = Object.freeze(['input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens']);

export class CloudAdapterError extends Error {
  constructor(message, { kind = 'error', status = null, code = null } = {}) { super(message); this.name = 'CloudAdapterError'; this.kind = kind; this.status = status; this.code = code; }
}

export function buildNewConversationBody() {
  return { scenario: 2, type: 0, provider: 0, agent: 'local_agent' };
}

/** 推理请求体：删除内部 lifecycle_owner 后原样发送（与打包代码一致）。 */
export function buildInferenceBody(payload) {
  const body = { ...payload };
  delete body.lifecycle_owner;
  return body;
}

/** 身份头（Authorization Bearer / id / Accept-Language），可叠加额外头。 */
export function buildAuthorityHeaders(authority, extra = {}) {
  return {
    Authorization: `Bearer ${authority.token}`,
    id: authority.ssoUid,
    'Accept-Language': authority.locale,
    ...extra,
  };
}

const isRecord = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const isPositiveSafeInt = (v) => Number.isSafeInteger(v) && v > 0;
const isNonNegSafeInt = (v) => Number.isSafeInteger(v) && v >= 0;
const isBoundedIdentifier = (v, max = 200) => typeof v === 'string' && v.length > 0 && v.length <= max;

// ---- 协议字段校验（抽公共函数，避免三处重复） ----
function invalid(message) { return new CloudAdapterError('protocol data invalid: ' + message, { kind: 'invalid_response' }); }
function requireRecord(v, what) { if (!isRecord(v)) throw invalid(`${what} must be an object`); return v; }
function requireStatus(v) { if (!TURN_STATUSES.includes(v)) throw invalid(`status invalid: ${String(v)}`); return v; }
function requireTurnId(v) { if (!isBoundedIdentifier(v, 200)) throw invalid('turn_id invalid'); return v; }
function requireMessageId(v) { if (!isPositiveSafeInt(v)) throw invalid('message_id must be a positive safe integer'); return v; }
function requireCheckpointSeq(v) { if (!isNonNegSafeInt(v)) throw invalid('checkpoint_seq must be a non-negative safe integer'); return v; }
function requireApplied(v) { if (typeof v !== 'boolean') throw invalid('applied must be boolean'); return v; }
function requireUsage(v) {
  requireRecord(v, 'usage');
  const out = {};
  for (const k of ['input_tokens', 'output_tokens']) if (!isNonNegSafeInt(v[k])) throw invalid(`usage.${k} must be a non-negative safe integer`);
  out.input_tokens = v.input_tokens; out.output_tokens = v.output_tokens;
  for (const k of ['cache_read_tokens', 'cache_write_tokens']) { if (v[k] !== undefined) { if (!isNonNegSafeInt(v[k])) throw invalid(`usage.${k} must be a non-negative safe integer`); out[k] = v[k]; } }
  return out;
}
function requireChatId(v) { if (!isPositiveSafeInt(v)) throw invalid('chatId must be a positive safe integer'); return v; }

function abortError(message, kind) { return new CloudAdapterError(message, { kind }); }

export function createCloudAdapter({ baseUrl, authority, fetchImpl = fetch, timeoutMs = 30000, dispatcher = undefined } = {}) {
  if (!baseUrl) throw new CloudAdapterError('baseUrl required', { kind: 'args' });
  const url = (path) => `${baseUrl}${path}`;

  /**
   * 用一个 AbortController 覆盖“整个操作”：请求头 + 响应体消费 + 解析/校验。
   * - 调用方 signal 已 abort → 在发起请求前直接失败（不进入 fetch）。
   * - 超时 → kind:'timeout'；用户取消 → kind:'aborted'。二者都从 AbortError 还原，不被伪装成 JSON 错误。
   * - finally 清理 timer 与 abort 监听；不覆盖已有 CloudAdapterError。
   */
  async function withDeadline(signal, fn) {
    if (signal?.aborted) throw abortError('operation aborted before start', 'aborted');
    const ac = new AbortController();
    let timedOut = false;
    const timer = timeoutMs > 0 ? setTimeout(() => { timedOut = true; ac.abort(abortError('operation timed out', 'timeout')); }, timeoutMs) : null;
    const onCallerAbort = () => ac.abort(signal.reason ?? abortError('operation aborted', 'aborted'));
    if (signal) signal.addEventListener('abort', onCallerAbort, { once: true });
    try {
      return await fn(ac.signal);
    } catch (e) {
      if (e instanceof CloudAdapterError) throw e;                       // 业务/协议错误原样抛出
      if (timedOut) throw abortError('operation timed out', 'timeout');
      if (signal?.aborted || ac.signal.aborted || e?.name === 'AbortError' || e?.name === 'TimeoutError') throw abortError('operation aborted', 'aborted');
      throw e;
    } finally {
      if (timer) clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onCallerAbort);
    }
  }

  async function fetchResponse(path, method, body, accept, sig) {
    const opts = {
      method,
      headers: buildAuthorityHeaders(authority, {
        Accept: accept,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      }),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: sig, redirect: 'error', cache: 'no-store', credentials: 'omit',
    };
    if (dispatcher) opts.dispatcher = dispatcher;
    return fetchImpl(url(path), opts);
  }

  async function requestJson(path, method, body, { signal, notFoundIsSuccess = false } = {}) {
    return withDeadline(signal, async (sig) => {
      const res = await fetchResponse(path, method, body, 'application/json', sig);
      const status = res.status;
      const ct = res.headers?.get?.('content-type') || '';
      const text = await res.text();                                       // 受同一 signal 保护
      if (!/application\/json/i.test(ct)) throw new CloudAdapterError(`invalid response (HTTP ${status})`, { kind: 'invalid_response', status });
      let payload;
      try { payload = JSON.parse(text); } catch { throw new CloudAdapterError(`invalid JSON (HTTP ${status})`, { kind: 'json', status }); }
      if (status === 401) throw new CloudAdapterError('authentication required', { kind: 'auth', status });
      if (!isRecord(payload) || typeof payload.msg !== 'string' || typeof payload.trace_id !== 'string') {
        throw new CloudAdapterError('response envelope invalid', { kind: 'invalid_response', status });
      }
      if (notFoundIsSuccess && status === 404 && payload.code === 404) return undefined;
      if (!res.ok || (payload.code !== 0 && payload.code !== 200)) {
        throw new CloudAdapterError('gateway rejected request', { kind: 'remote_rejected', status, code: Number(payload.code) });
      }
      if (!('data' in payload)) throw new CloudAdapterError('response missing data', { kind: 'invalid_response', status });
      return payload.data;
    });
  }

  return {
    baseUrl,
    async createConversation({ signal } = {}) {
      const data = await requestJson('/chat/new', 'POST', buildNewConversationBody(), { signal });
      requireRecord(data, 'chat/new data');
      if (!isPositiveSafeInt(data.id)) throw invalid('chat/new id must be a positive safe integer');
      return data.id;
    },
    async getModels({ signal } = {}) {
      const data = await requestJson('/local-agent/models', 'GET', undefined, { signal });
      try { return parseCapabilities(data); } catch (e) { throw new CloudAdapterError('incompatible model capabilities: ' + e.message, { kind: 'invalid_response' }); }
    },
    /** 发起推理并消费 SSE，返回合并结果。要求 content-type=text/event-stream 且序列以 message_end 正常终止。 */
    async startInference(payload, { signal, onEvent } = {}) {
      return withDeadline(signal, async (sig) => {
        const res = await fetchResponse('/local-agent/messages', 'POST', buildInferenceBody(payload), 'text/event-stream', sig);
        const status = res.status;
        const ct = res.headers?.get?.('content-type') || '';
        if (status === 401) throw new CloudAdapterError('authentication required', { kind: 'auth', status });
        if (!res.ok || !ct.toLowerCase().includes('text/event-stream')) {
          let snippet = '';
          try { snippet = (await res.text()).slice(0, 160).replace(/[A-Za-z0-9_-]{24,}/g, '<BLOB>'); } catch { /* ignore */ }
          throw new CloudAdapterError(`inference not a valid SSE stream (HTTP ${status})${snippet ? ' :: ' + snippet : ''}`, { kind: 'invalid_response', status });
        }
        const framer = new GatewaySSEFramer();
        const seq = new GatewayEventSequence();
        const merger = new GatewayStreamMerger();
        const reader = res.body.getReader();
        let terminalError = null;
        const consume = (raw) => { const event = parseGatewayEvent(raw); seq.accept(event); merger.apply(event); onEvent?.(event); if (event.type === 'error') terminalError = { code: event.code, message: event.message, retryable: event.retryable }; };
        try {
          for (;;) {
            if (sig.aborted) throw abortError('operation aborted', 'aborted');
            const { done, value } = await reader.read();                    // 受同一 signal 保护
            if (done) break;
            for (const raw of framer.push(value)) consume(raw);
          }
          for (const raw of framer.flush()) consume(raw);
        } finally {
          try { await reader.cancel(); } catch { /* ignore */ }             // 清理不无限等待
        }
        seq.finish();
        if (terminalError) throw new CloudAdapterError('inference ended with error event: ' + terminalError.code, { kind: 'remote_rejected', code: terminalError.code });
        return { responseId: merger.responseId, model: merger.model, thinking: merger.thinking, content: merger.content, usage: merger.usage, stopReason: merger.stopReason, tools: [...merger.tools.values()] };
      });
    },
    async conversationStart(chatId, body, { signal } = {}) {
      requireChatId(chatId);
      requireRecord(body, 'start body');
      const data = requireRecord(await requestJson(DESKTOP_PATHS.localTurns(chatId), 'POST', body, { signal }), 'local-turns data');
      return { turnId: requireTurnId(data.turn_id), messageId: requireMessageId(data.message_id), status: requireStatus(data.status), checkpointSeq: requireCheckpointSeq(data.checkpoint_seq) };
    },
    async conversationCheckpoint(chatId, turnId, body, { signal } = {}) {
      requireChatId(chatId); requireTurnId(turnId); requireRecord(body, 'checkpoint body');
      const data = requireRecord(await requestJson(DESKTOP_PATHS.localTurnCheckpoint(chatId, turnId), 'POST', body, { signal }), 'checkpoint data');
      return { applied: requireApplied(data.applied), status: requireStatus(data.status), checkpointSeq: requireCheckpointSeq(data.checkpoint_seq) };
    },
    async conversationComplete(chatId, turnId, body, { signal } = {}) {
      requireChatId(chatId); requireTurnId(turnId); requireRecord(body, 'complete body');
      const data = requireRecord(await requestJson(DESKTOP_PATHS.localTurnComplete(chatId, turnId), 'POST', body, { signal }), 'complete data');
      const responseTurnId = requireTurnId(data.turn_id);
      if (String(responseTurnId) !== String(turnId)) throw invalid('turn_id mismatch with request');
      return {
        turnId: responseTurnId,
        messageId: requireMessageId(data.message_id),
        status: requireStatus(data.status),
        checkpointSeq: requireCheckpointSeq(data.checkpoint_seq),
        usage: requireUsage(data.usage),
      };
    },
  };
}

export { GatewayProtocolError };
