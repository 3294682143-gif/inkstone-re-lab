// src/desktop/models-contract.mjs
// 桌面端 /local-agent/models 能力目录契约（protocol_version 必须为 "2.0"）。
// 依据：0.2.7 主 bundle 静态确认（parseCapabilities，out/main/index-CYl10ENn.js:38718 起）。

export const MODELS_PROTOCOL_VERSION = '2.0';
export const ANSWER_TRANSPORTS = Object.freeze(['tool_arguments', 'finalization_round', 'native_terminal_content', 'strict_eof']);
export const LIMIT_NAMES = Object.freeze([
  'max_request_bytes', 'max_messages', 'max_tools', 'max_tool_name_bytes', 'max_tool_description_bytes',
  'max_tool_input_schema_bytes', 'max_start_prompt_bytes', 'max_checkpoint_bytes', 'max_prompt_bytes',
  'max_thinking_bytes', 'max_answer_bytes', 'max_agent_events', 'max_agent_event_bytes', 'max_agent_events_bytes',
]);

export class ModelContractError extends Error {
  constructor(message) { super(message); this.name = 'ModelContractError'; }
}
const isRecord = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const posInt = (v, name) => { if (!Number.isSafeInteger(v) || v <= 0) throw new ModelContractError(`limit ${name} must be a positive integer`); return v; };
const boundedText = (v, max, allowEmpty = false) => typeof v === 'string' && Buffer.byteLength(v, 'utf8') <= max && (allowEmpty || v.length > 0);

export function normalizeAnswerTransport(advertised) {
  return advertised === 'native_terminal_content' ? 'strict_eof' : advertised;
}

/** 校验并规范化 /local-agent/models 返回的 data（能力目录 + 限额）。 */
export function parseCapabilities(value) {
  const capability = value;
  if (!isRecord(capability)) throw new ModelContractError('Model capability is invalid');
  if (capability.protocol_version !== MODELS_PROTOCOL_VERSION) throw new ModelContractError('Model protocol version is incompatible');

  const rawModels = capability.models;
  if (!Array.isArray(rawModels) || rawModels.length === 0 || rawModels.length > 128) throw new ModelContractError('Model directory is invalid');

  const models = rawModels.map((candidate) => {
    const model = candidate;
    const advertised = model.answer_transport;
    if (typeof model.supports_thinking !== 'boolean' || model.supports_tools !== true || model.supports_attachments !== false
        || !ANSWER_TRANSPORTS.includes(String(advertised))) {
      throw new ModelContractError('Model capability is invalid');
    }
    if (model.pro !== undefined && typeof model.pro !== 'boolean') throw new ModelContractError('Model pro capability is invalid');
    if (model.local_icon !== undefined && !boundedText(model.local_icon, 2048, true)) throw new ModelContractError('Model local icon is invalid');
    const tags = model.tags ?? [];
    if (!Array.isArray(tags) || tags.length > 8 || !tags.every((t) => boundedText(t, 64))) throw new ModelContractError('Model tags are invalid');
    const contextWindow = posInt(model.context_window, 'context_window');
    const maxOutputTokens = posInt(model.max_output_tokens, 'max_output_tokens');
    if (maxOutputTokens >= contextWindow) throw new ModelContractError('Model token limits are invalid');
    return {
      id: boundedText(model.id, 120) ? model.id : (() => { throw new ModelContractError('model id invalid'); })(),
      canonical_id: boundedText(model.canonical_id, 120) ? model.canonical_id : (() => { throw new ModelContractError('canonical_id invalid'); })(),
      display_name: boundedText(model.display_name, 200) ? model.display_name : (() => { throw new ModelContractError('display_name invalid'); })(),
      ...(model.local_icon ? { local_icon: model.local_icon } : {}),
      context_window: contextWindow,
      max_output_tokens: maxOutputTokens,
      supports_thinking: model.supports_thinking,
      supports_tools: true,
      supports_attachments: false,
      answer_transport: normalizeAnswerTransport(advertised),
      tags: [...tags],
      pro: model.pro === true,
    };
  });

  const rawLimits = capability.limits;
  if (!isRecord(rawLimits)) throw new ModelContractError('Model capability limits are invalid');
  const limits = Object.fromEntries(LIMIT_NAMES.map((name) => [name, posInt(rawLimits[name], name)]));
  if (limits.max_messages > 1e4 || limits.max_tools > 128 || limits.max_tool_name_bytes > 64
      || limits.max_tool_description_bytes > 4096 || limits.max_tool_input_schema_bytes > 262144
      || limits.max_prompt_bytes > limits.max_request_bytes
      || limits.max_thinking_bytes > limits.max_checkpoint_bytes
      || limits.max_answer_bytes > limits.max_checkpoint_bytes
      || limits.max_agent_event_bytes > limits.max_agent_events_bytes) {
    throw new ModelContractError('Model capability limits are invalid');
  }
  return { protocol_version: MODELS_PROTOCOL_VERSION, models, limits };
}
