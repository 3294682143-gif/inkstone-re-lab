// src/desktop/cloud-adapter.mjs
// 桌面端 cloud gateway 纯 Node HTTP adapter（可注入 fetch），仅实现已静态确认的请求结构与校验。
// 依据：0.2.7 主 bundle 静态确认（/chat/new scenario:2、/local-agent/models、/local-agent/messages、
//      /chat/{id}/local-turns[|/{turnId}/checkpoint|/complete]、headers()、requestJsonURL 的 credentials:"omit"）。
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

export function createCloudAdapter({ baseUrl, authority, fetchImpl = fetch, timeoutMs = 30000, dispatcher = undefined } = {}) {
  if (!baseUrl) throw new CloudAdapterError('baseUrl required', { kind: 'args' });
  const url = (path) => `${baseUrl}${path}`;

  async function request({ path, method, body, accept = 'application/json', signal }) {
    const ac = new AbortController();
    const timer = timeoutMs > 0 ? setTimeout(() => ac.abort(new Error('timeout')), timeoutMs) : null;
    const sig = signal ? AbortSignal.any([signal, ac.signal]) : ac.signal;
    try {
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
      return await fetchImpl(url(path), opts);
    } finally { if (timer) clearTimeout(timer); }
  }

  async function requestJson(path, method, body, { notFoundIsSuccess = false } = {}) {
    const res = await request({ path, method, body });
    const status = res.status;
    const ct = res.headers?.get?.('content-type') || '';
    let text = '';
    try { text = await res.text(); } catch { /* ignore */ }
    let payload;
    if (!/application\/json/i.test(ct)) throw new CloudAdapterError(`invalid response (HTTP ${status})`, { kind: 'invalid_response', status });
    try { payload = JSON.parse(text); } catch { throw new CloudAdapterError(`invalid JSON (HTTP ${status})`, { kind: 'invalid_response', status }); }
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
  }

  return {
    baseUrl,
    async createConversation({ signal } = {}) {
      const data = await requestJson('/chat/new', 'POST', buildNewConversationBody(), { signal });
      if (!isRecord(data) || !Number.isSafeInteger(data.id) || data.id <= 0) throw new CloudAdapterError('invalid chat id', { kind: 'invalid_response' });
      return data.id;
    },
    async getModels({ signal } = {}) {
      const data = await requestJson('/local-agent/models', 'GET', undefined, { signal });
      try { return parseCapabilities(data); } catch (e) { throw new CloudAdapterError('incompatible model capabilities: ' + e.message, { kind: 'invalid_response' }); }
    },
    /** 发起推理并消费 SSE，返回合并结果。要求 content-type=text/event-stream 且序列以 message_end 正常终止。 */
    async startInference(payload, { signal, onEvent } = {}) {
      const res = await request({ path: '/local-agent/messages', method: 'POST', body: buildInferenceBody(payload), accept: 'text/event-stream', signal });
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
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          for (const raw of framer.push(value)) {
            const event = parseGatewayEvent(raw);
            seq.accept(event);
            merger.apply(event);
            onEvent?.(event);
            if (event.type === 'error') terminalError = { code: event.code, message: event.message, retryable: event.retryable };
          }
        }
        for (const raw of framer.flush()) {
          const event = parseGatewayEvent(raw);
          seq.accept(event); merger.apply(event); onEvent?.(event);
          if (event.type === 'error') terminalError = { code: event.code, message: event.message, retryable: event.retryable };
        }
      } finally { try { await reader.cancel(); } catch { /* ignore */ } }
      seq.finish();                       // 缺终止事件会抛错
      if (terminalError) throw new CloudAdapterError('inference ended with error event: ' + terminalError.code, { kind: 'remote_rejected', code: terminalError.code });
      return { responseId: merger.responseId, model: merger.model, thinking: merger.thinking, content: merger.content, usage: merger.usage, stopReason: merger.stopReason, tools: [...merger.tools.values()] };
    },
    async conversationStart(chatId, body, { signal } = {}) {
      const data = await requestJson(DESKTOP_PATHS.localTurns(chatId), 'POST', body, { signal });
      return data;
    },
    async conversationCheckpoint(chatId, turnId, body, { signal } = {}) {
      const data = await requestJson(DESKTOP_PATHS.localTurnCheckpoint(chatId, turnId), 'POST', body, { signal });
      if (!isRecord(data) || typeof data.applied !== 'boolean') throw new CloudAdapterError('checkpoint result invalid', { kind: 'invalid_response' });
      return data;
    },
    async conversationComplete(chatId, turnId, body, { signal } = {}) {
      const data = await requestJson(DESKTOP_PATHS.localTurnComplete(chatId, turnId), 'POST', body, { signal });
      return data;
    },
  };
}

export { GatewayProtocolError };
