// 请求构造模块（离线；不联网）。字段来自实测契约 04-contracts/api-contract.md。
// 只构造本地对象；是否联网由调用方在 P5 决定。
export const CHAT_SEND_PATH = '/api/orbit/v1/chat';
export const CHAT_NEW_PATH = '/api/orbit/v1/chat/new';

const REQUIRED = ['chat_id', 'query'];

/**
 * 构造发送消息的请求体（与实测字段一致）。
 * @param {{chatId:number|string, query:string, model?:string, thinkingMode?:any, planningMode?:any, scenario?:number}} o
 */
export function buildChatSendBody(o = {}) {
  const chat_id = o.chatId;
  if (chat_id === undefined || chat_id === null || chat_id === '')
    throw new Error('chat_id 缺失：必须使用真实返回的会话 id（不复用样本中的固定 ID）');
  if (typeof o.query !== 'string' || o.query.length === 0)
    throw new Error('query 缺失：本轮用户文本必填');
  return {
    scenario: o.scenario ?? 1,
    thinking_mode: o.thinkingMode ?? false,
    planning_mode: o.planningMode ?? false,
    model: o.model ?? '',
    query: o.query,
    chat_id: (typeof chat_id === 'string' && /^\d+$/.test(chat_id)) ? Number(chat_id) : chat_id,
  };
}

/** 构造新建会话请求体。 */
export function buildChatNewBody(o = {}) {
  const b = { scenario: o.scenario ?? 1 };
  if (o.spaceId !== undefined) b.space_id = o.spaceId;
  return b;
}

export function assertHasFields(body, fields = REQUIRED) {
  const missing = fields.filter(f => body[f] === undefined);
  if (missing.length) throw new Error('缺少字段: ' + missing.join(','));
  return true;
}
