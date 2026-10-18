// src/desktop/recovery.mjs
// 冲突恢复判定（纯函数，来自 0.2.7 主 bundle 静态证据：M:37301 canRecoverInferenceConflict、M:39046 inferenceConflictCode、M:39054 waitForInferenceRetry）。
// 仅落实“已确认”的判定；不新增可能重复提交回合的自动重放。

export const INFERENCE_CONFLICT_DELAY_MS = 750;   // M:36714
export const INFERENCE_DRAIN_PROOF_MS = 5000;     // M:36713

const isRecord = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/** HTTP 409 冲突码 → 恢复类别（与打包实现一致）。 */
export function inferenceConflictCode(payload, kind) {
  if (!isRecord(payload) || !isRecord(payload.data)) return undefined;
  const data = payload.data;
  if (data.ambiguous !== undefined && data.ambiguous !== false) return undefined;
  if (payload.ambiguous !== undefined && payload.ambiguous !== false) return undefined;
  if (kind === 'turn' && payload.code === 409001 && data.reason === 'TURN_CONFLICT') return 'TURN_CONFLICT_RECOVERY';
  if (payload.code === 409005 && data.reason === 'INFERENCE_ALREADY_RUNNING' && data.retryable === true) return 'INFERENCE_LEASE_RECOVERY';
  return undefined;
}

/** 是否具备恢复条件（drain proof 有效且无抑制/取消/关闭/兄弟）。 */
export function canRecoverInferenceConflict({
  recoveryProof, requestId, now = Date.now(),
  deliverySuppressed = false, aborted = false, closed = false, hasSibling = false,
  drainProofMs = INFERENCE_DRAIN_PROOF_MS,
} = {}) {
  const proof = recoveryProof;
  const age = proof ? now - proof.drainedAt : -1;
  return Boolean(proof && proof.requestId !== requestId && age >= 0 && age <= drainProofMs
    && !deliverySuppressed && !aborted && !closed && !hasSibling);
}

/** 只在首次尝试、有恢复码、且可恢复时才允许重试一次（不自动重复提交）。 */
export function shouldRetryInferenceConflict({ code, attempt = 0, recoverable = false } = {}) {
  return attempt === 0 && Boolean(code) && recoverable === true;
}
