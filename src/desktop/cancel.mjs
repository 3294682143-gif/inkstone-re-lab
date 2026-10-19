// src/desktop/cancel.mjs
// 推理取消判定（纯函数），来自 0.2.7 主 bundle 静态证据：M:37241 cancelInference、M:36711/36712 drain 超时。
// 只落实“已确认”的判定；不推断服务端计费或“已停止”。

export const INFERENCE_DRAIN_TIMEOUT_MS = 2500;              // M:36711
export const INDEPENDENT_REVIEW_DRAIN_TIMEOUT_MS = 30000;    // M:36712

export class CancelProtocolError extends Error {
  constructor(code) { super(code); this.name = 'CancelProtocolError'; this.code = code; }
}

/**
 * 依据 cancelInference 静态规则判定取消是否成功。
 * 输入为已解析的状态；不发起任何网络请求。
 * @returns {{cancelled:boolean, reason:string, recordsRecoveryProof?:boolean}}
 */
export function cancelInferenceDecision({
  activePresent,
  activeStreamId = null,
  activeIndependent = false,
  activeSemanticTerminal = null,
  retired = null,                 // { streamId, semanticTerminal? } | null
  requestId,
  streamId,
  joined = false,
  signalAborted = false,
  closed = false,
} = {}) {
  // 身份核对（不匹配直接拒绝，与源码一致）
  if (!activePresent) {
    if (!retired || retired.streamId !== streamId) throw new CancelProtocolError('stream_not_found');
  } else if (activeStreamId !== streamId) {
    throw new CancelProtocolError('stream_mismatch');
  }
  // 活跃推理的排空确认
  if (activePresent) {
    if (!joined) return { cancelled: false, reason: 'drain_unconfirmed' };
    if (activeIndependent && activeSemanticTerminal == null) return { cancelled: false, reason: 'drain_unconfirmed' };
  }
  if (signalAborted || closed) return { cancelled: false, reason: 'aborted_or_closed' };
  // 已退役记录的核对
  if (!retired || retired.streamId !== streamId) return { cancelled: false, reason: 'not_drained' };
  if (retired.independent && retired.semanticTerminal == null) return { cancelled: false, reason: 'independent_not_terminal' };
  return { cancelled: true, reason: 'cancelled', recordsRecoveryProof: retired.semanticTerminal === 'message_end' };
}
