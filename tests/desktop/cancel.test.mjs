import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cancelInferenceDecision, CancelProtocolError, INFERENCE_DRAIN_TIMEOUT_MS, INDEPENDENT_REVIEW_DRAIN_TIMEOUT_MS } from '../../src/desktop/cancel.mjs';

test('常量与静态证据一致', () => {
  assert.equal(INFERENCE_DRAIN_TIMEOUT_MS, 2500);
  assert.equal(INDEPENDENT_REVIEW_DRAIN_TIMEOUT_MS, 30000);
});

test('身份不匹配：stream_not_found / stream_mismatch', () => {
  assert.throws(() => cancelInferenceDecision({ activePresent: false, retired: null, requestId: 'r', streamId: 's' }), (e) => e instanceof CancelProtocolError && e.code === 'stream_not_found');
  assert.throws(() => cancelInferenceDecision({ activePresent: false, retired: { streamId: 'other' }, requestId: 'r', streamId: 's' }), (e) => e.code === 'stream_not_found');
  assert.throws(() => cancelInferenceDecision({ activePresent: true, activeStreamId: 'other', requestId: 'r', streamId: 's' }), (e) => e.code === 'stream_mismatch');
});

test('活跃推理：排空未确认 → cancelled:false', () => {
  assert.equal(cancelInferenceDecision({ activePresent: true, activeStreamId: 's', requestId: 'r', streamId: 's', joined: false }).cancelled, false);
  // independent 且无语义终态 → 同样未确认
  const d = cancelInferenceDecision({ activePresent: true, activeStreamId: 's', activeIndependent: true, activeSemanticTerminal: null, requestId: 'r', streamId: 's', joined: true });
  assert.equal(d.cancelled, false);
  assert.equal(d.reason, 'drain_unconfirmed');
});

test('已取消/关闭 → cancelled:false', () => {
  assert.equal(cancelInferenceDecision({ activePresent: true, activeStreamId: 's', requestId: 'r', streamId: 's', joined: true, signalAborted: true }).cancelled, false);
});

test('成功取消：已排空且 streamId 一致', () => {
  const d = cancelInferenceDecision({ activePresent: true, activeStreamId: 's', requestId: 'r', streamId: 's', joined: true, retired: { streamId: 's', semanticTerminal: 'message_end' } });
  assert.equal(d.cancelled, true);
  assert.equal(d.recordsRecoveryProof, true);          // 记录 drainedInferences → 供后续 recoveryProof
});

test('未排空 / 独立无终态 → 拒绝取消', () => {
  assert.equal(cancelInferenceDecision({ activePresent: true, activeStreamId: 's', requestId: 'r', streamId: 's', joined: true, retired: null }).cancelled, false);
  assert.equal(cancelInferenceDecision({ activePresent: true, activeStreamId: 's', requestId: 'r', streamId: 's', joined: true, retired: { streamId: 'other' } }).cancelled, false);
  const indep = cancelInferenceDecision({ activePresent: true, activeStreamId: 's', requestId: 'r', streamId: 's', joined: true, retired: { streamId: 's', independent: true, semanticTerminal: null } });
  assert.equal(indep.cancelled, false);
  assert.equal(indep.reason, 'independent_not_terminal');
});

test('error 终态成功取消但不记录 recoveryProof（仅 message_end 记录）', () => {
  const d = cancelInferenceDecision({ activePresent: true, activeStreamId: 's', requestId: 'r', streamId: 's', joined: true, retired: { streamId: 's', semanticTerminal: 'error' } });
  assert.equal(d.cancelled, true);
  assert.equal(d.recordsRecoveryProof, false);
});

// —— L1.1：drainRecorded 去重与恢复窗口 ——
test('L1.1 首个 message_end 生成恢复凭据；已记录后不再要求记录', () => {
  const first = cancelInferenceDecision({ activePresent: false, requestId: 'r', streamId: 's', retired: { streamId: 's', semanticTerminal: 'message_end', drainRecorded: false } });
  assert.equal(first.cancelled, true);
  assert.equal(first.recordsRecoveryProof, true);
  const again = cancelInferenceDecision({ activePresent: false, requestId: 'r', streamId: 's', retired: { streamId: 's', semanticTerminal: 'message_end', drainRecorded: true } });
  assert.equal(again.cancelled, true);            // 仍可报告取消成功
  assert.equal(again.recordsRecoveryProof, false); // 但不得再次记录（=> 不刷新 drainedAt）
});

test('L1.1 error 终态不生成恢复凭据', () => {
  const d = cancelInferenceDecision({ activePresent: false, requestId: 'r', streamId: 's', retired: { streamId: 's', semanticTerminal: 'error', drainRecorded: false } });
  assert.equal(d.cancelled, true);
  assert.equal(d.recordsRecoveryProof, false);
});

test('L1.1 已记录后，原 5000ms 恢复窗口过期仍过期（不因重复取消刷新）', async () => {
  const { canRecoverInferenceConflict, INFERENCE_DRAIN_PROOF_MS } = await import('../../src/desktop/recovery.mjs');
  const drainedAt = 1_000_000;
  const proof = { requestId: 'old', drainedAt };
  assert.equal(canRecoverInferenceConflict({ recoveryProof: proof, requestId: 'new', now: drainedAt + INFERENCE_DRAIN_PROOF_MS }), true);
  assert.equal(canRecoverInferenceConflict({ recoveryProof: proof, requestId: 'new', now: drainedAt + INFERENCE_DRAIN_PROOF_MS + 1 }), false);
});
