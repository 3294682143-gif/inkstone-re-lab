// 网页端 SSE 事件 → 会话状态补丁。
// 语义来源：MOCE 聊天模块 xa(e,t)（见 03-analysis/readable/xa-event-mapper.js 与
// 01-evidence/sanitized/web-chat-module-source-20261020.json S4）。
// 说明：原实现把补丁逻辑放在 wa(c, patch) 里；这里直接返回合并后的状态。

export const TERMINAL_EVENTS = new Set(['message_end', 'done', 'close', 'error', 'workflow_finished']);

/** 事件类型：优先 event，其次 type（原 ha() 的行为未定位，按双字段兼容处理）。 */
export function eventType(event) {
  if (!event || typeof event !== 'object') return '';
  const raw = event.event ?? event.type ?? '';
  return String(raw);
}

function pickId(a, b, c) {
  for (const v of [a, b, c]) {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  }
  return undefined;
}

function normalizeFollowups(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((item, index) => {
      if (item && typeof item === 'object') {
        const text = String(item.text || item.label || item.query || '');
        return {
          id: String(item.id || index),
          text,
          type: typeof item.type === 'string' ? item.type : undefined,
          extra: typeof item.extra === 'string' ? item.extra : undefined,
          payload: item,
        };
      }
      return { id: String(index), text: String(item) };
    })
    .filter((x) => x.text);
}

function normalizeContinueActions(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((item, index) => {
      if (item && typeof item === 'object') {
        const label = String(item.label || item.text || item.query || '');
        return {
          id: String(item.id || index),
          label,
          primary: Boolean(item.primary),
          disabled: Boolean(item.disabled),
          payload: item,
        };
      }
      return { id: String(index), label: String(item) };
    })
    .filter((x) => x.label);
}

/**
 * 把一个 SSE 事件合并进会话状态（对应原 xa）。
 * @param {object} state 会话状态
 * @param {object} event 事件对象
 * @returns {object} 新状态
 */
export function applyEvent(state, event) {
  if (!event || typeof event !== 'object') return state;
  const type = eventType(event);
  const isSubagent = type.includes('subagent');
  const agent = event.agent && typeof event.agent === 'object' ? event.agent : undefined;
  const result =
    event.result && typeof event.result === 'object'
      ? event.result
      : agent && agent.result && typeof agent.result === 'object'
        ? agent.result
        : undefined;

  const chatId = pickId(event.chat_id, event.cid, event.chatId);
  const messageId = pickId(event.message_id, event.mid, event.messageId);

  let next = {
    ...state,
    chatId: chatId ?? state.chatId,
    messageId: messageId ?? state.messageId,
    model: event.model ?? state.model,
    updatedAt: Date.now(),
  };

  if (Object.prototype.hasOwnProperty.call(event, 'feedback')) {
    next = { ...next, feedback: event.feedback };
  }

  if (type === 'message') next = { ...next, isWaitingForMessage: false };
  if (type === 'message_end') next = { ...next, done: true, answerEnded: true };
  else if (type === 'done' || type === 'close' || type === 'workflow_finished') next = { ...next, done: true };

  if (type === 'error') {
    next = {
      ...next,
      error: String(event.error || event.msg || event.message || '请求出错了，请稍后再试'),
      isWaitingForMessage: false,
      hasMessageEnded: true,
      isAgentComplete: true,
    };
  }

  const responseDelta = isSubagent
    ? undefined
    : event.answer || event.delta || event.response || (type === 'message' ? event.text : undefined);
  if (typeof responseDelta === 'string') {
    next = { ...next, assistantResponse: (next.assistantResponse || '') + responseDelta, responseDelta };
  }

  const thinkingDelta = isSubagent
    ? undefined
    : event.thinking || (type.includes('thinking') ? event.text : undefined);
  if (typeof thinkingDelta === 'string') {
    next = { ...next, thinking: (next.thinking || '') + thinkingDelta, thinkingDelta };
  }

  const followups = normalizeFollowups(event.followups || event.followup || result?.followups || result?.followup);
  if (followups.length) next = { ...next, followupActions: followups };

  const continues = normalizeContinueActions(event.continue_actions || result?.continue_actions);
  if (continues.length) next = { ...next, continueActions: continues };

  if (Array.isArray(event.agent_events)) next = { ...next, agentEvents: event.agent_events };
  else if (agent) next = { ...next, agentEvent: isSubagent ? { ...agent, event: type } : agent };
  else if (type.includes('tool') || type.includes('subagent')) next = { ...next, agentEvent: event };

  return next;
}

/** 是否终态事件。 */
export function isTerminal(type) {
  return TERMINAL_EVENTS.has(String(type));
}
