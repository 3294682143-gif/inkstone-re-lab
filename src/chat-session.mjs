// 聊天会话层：封装 chat/new 与 chat 发送，严格校验 HTTP 状态、Content-Type、业务结果与正常结束事件。
// 失败一律抛 ChatError（含 kind），绝不在错误信息中输出凭据或完整敏感响应。
import { SSEFrameParser, ChatStreamMerger } from './stream-parser.mjs';
import { buildChatSendBody, buildChatNewBody, CHAT_SEND_PATH, CHAT_NEW_PATH } from './build-chat-request.mjs';

export class ChatError extends Error {
  constructor(message, { kind = 'error', status = null, code = null, partial = null } = {}) {
    super(message);
    this.name = 'ChatError';
    this.kind = kind;         // args | http | content-type | json | business | incomplete | timeout
    this.status = status;
    this.code = code;
    this.partial = partial;   // 诊断用的部分回答（可能为 null）
  }
}

/** 仅保留可诊断的短摘要，去除疑似凭证/长串。 */
export function sanitizeSnippet(s, max = 160) {
  if (typeof s !== 'string') return '';
  return s.replace(/[A-Za-z0-9_-]{24,}/g, '<BLOB>').replace(/\s+/g, ' ').slice(0, max);
}

export function createChatSession({ http, headers, timeoutMs = 60000 }) {
  async function postJson(path, body) {
    const ac = new AbortController();
    const timer = timeoutMs > 0 ? setTimeout(() => ac.abort(new Error('请求超时')), timeoutMs) : null;
    try {
      const res = await http.post(path, { headers, body, accept: 'application/json', signal: ac.signal });
      const status = res.status;
      const ct = res.headers?.get?.('content-type') || '';
      if (status < 200 || status >= 300) throw new ChatError(`HTTP ${status}`, { kind: 'http', status });
      if (!/application\/json/i.test(ct)) throw new ChatError(`非 JSON 响应 (Content-Type=${ct})`, { kind: 'content-type', status });
      let text = '';
      try { text = await res.text(); } catch { throw new ChatError('读取响应失败', { kind: 'json', status }); }
      let j;
      try { j = JSON.parse(text); } catch { throw new ChatError('响应不是合法 JSON', { kind: 'json', status }); }
      return j;
    } finally { if (timer) clearTimeout(timer); }
  }

  async function newConversation() {
    const j = await postJson(CHAT_NEW_PATH, buildChatNewBody({}));
    if (j.code !== 0 || !j.data?.id) {
      throw new ChatError(`chat/new 业务失败: code=${j.code}`, { kind: 'business', code: j.code });
    }
    return j.data.id;
  }

  async function send(chatId, text, { model = 'Auto', thinkingMode = true } = {}) {
    const body = buildChatSendBody({ chatId, query: text, model, thinkingMode, planningMode: false });
    const ac = new AbortController();
    const timer = timeoutMs > 0 ? setTimeout(() => ac.abort(new Error('读取超时')), timeoutMs) : null;
    let reader = null;
    try {
      const res = await http.post(CHAT_SEND_PATH, { headers, body, accept: 'text/event-stream', signal: ac.signal });
      const status = res.status;
      const ct = res.headers?.get?.('content-type') || '';
      if (status < 200 || status >= 300) {
        let detail = '';
        try { detail = sanitizeSnippet(await res.text()); } catch { /* ignore */ }
        throw new ChatError(`发送失败 HTTP ${status}${detail ? ' :: ' + detail : ''}`, { kind: 'http', status });
      }
      if (!/text\/event-stream/i.test(ct)) {
        let detail = '';
        try { detail = sanitizeSnippet(await res.text()); } catch { /* ignore */ }
        throw new ChatError(`响应不是 SSE (Content-Type=${ct})${detail ? ' :: ' + detail : ''}`, { kind: 'content-type', status });
      }
      const parser = new SSEFrameParser();
      const merger = new ChatStreamMerger();
      reader = res.body.getReader();
      for (;;) {
        if (ac.signal.aborted) throw new ChatError('读取超时', { kind: 'timeout', partial: merger.answer });
        const { done, value } = await reader.read();
        if (done) break;
        merger.applyAll(parser.push(value));
        if (merger.finished) break;
      }
      merger.applyAll(parser.flush());
      if (!merger.finished) {
        throw new ChatError('流未正常结束：缺少 workflow_finished', { kind: 'incomplete', partial: merger.answer });
      }
      return {
        status, finished: true, cid: merger.cid, mid: merger.mid,
        answer: merger.answer, thinking: merger.thinking,
        followups: merger.followups, unknown: merger.unknown, events: merger.events,
      };
    } finally {
      if (timer) clearTimeout(timer);
      try { await reader?.cancel?.(); } catch { /* ignore */ }
    }
  }

  return { newConversation, send };
}
