# 停止、冲突恢复与事件顺序（桌面 0.2.7）

- 证据：**M** = `out/main/index-CYl10ENn.js`（`f4b8148d…`）
- 证据等级：STATIC_CONFIRMED / INFERRED / UNKNOWN
- 片段：`snippets-r2/C-*.txt`、`snippets/stop-turn.txt`

## 1. 停止（stop）

- 本地 UI → `ChatFeature.stopTurn`（schema `{requestId}`，M:66199/66277）→ `CoreChatRuntime.stopTurn`（M:56774）。
- 运行时停止：`ready.supervisor.callRuntime("turn.stop", { requestId, expectedTurnId })`；要求 `result.stopped === true`（M:56786-56791）。若投影中无该 active → 直接清理返回。
- 停止后本地收尾：`projection.stopTurn(requestId)`、`retireTurnApprovals`、`closeObservedToolCalls`、`releaseExternalSkills`（M:56793-56807）。
- Headless 停止并排空：`stopAndDrainHeadlessTurn`：先 `host.stopTurn(requestId)`，再轮询 `history` 直到 `activeRequestId !== requestId`，上限 `STOP_DRAIN_TIMEOUT_MS = 5000`，`POLL_INTERVAL_MS = 100`（M:118069-118077, M:117893）。

**边界区分（必须保持）**：
1. 取消本地等待或 HTTP 流 ≠ 服务端停止。
2. `turn.stop` RPC 请求服务端停止。
3. 等待回合排空（drain）是本地轮询判定。
4. 持久化停止/失败状态由 projection + gateway 处理。
→ **不得**由“本地 abort 成功”推断“服务端推理已停止”，也**不得**推断计费结果（UNKNOWN）。

## 2. 冲突恢复（HTTP 409）

- `inferenceConflictCode(payload, kind)`（M:39046）：
  - `payload.code === 409001 && data.reason === "TURN_CONFLICT"`（kind=turn）→ `TURN_CONFLICT_RECOVERY`。
  - `payload.code === 409005 && data.reason === "INFERENCE_ALREADY_RUNNING" && data.retryable === true` → `INFERENCE_LEASE_RECOVERY`。
  - `data.ambiguous`/`payload.ambiguous` 若非 false → 不恢复（返回 undefined）。
- 恢复条件 `canRecoverInferenceConflict(active)`（M:37301）：需 `recoveryProof`，且其 `requestId !== active.requestId`、`age ≤ INFERENCE_DRAIN_PROOF_MS = 5000`、未 `deliverySuppressed`、未 abort、未 closed、无同 lease 兄弟。
- 重试间隔：`waitForInferenceRetry` 固定 `INFERENCE_CONFLICT_DELAY_MS = 750`，定时器 `unref`，尊重 abort（M:39054-39065）。
- 触发：仅在 `attempt === 0` 且存在 `recoveryCode` 且 `canRecoverInferenceConflict` 为真时才重试一次（M:37767-37773）。
→ 因此**不新增**可能重复提交回合的自动重放；无 `recoveryProof` 时不恢复（reject）。

## 3. 事件顺序：accepted 与终态通知

- Headless：`startHeadlessTurn` 先 `await host.startTurn(...)`，完成回调（`active.completion`）在推理推进后才 `emit({method:"turn.completed"|"turn.failed", ...})`（M:117992-118090, M:118566-118600）。
  → 正常序：**accepted 先于终态通知**（STATIC_CONFIRMED）。
- stdout 是单一有序流；**不能**用“单一 stdout 会自行重排”作为乱序依据。交错仅在实现层不可完全排除，故关联器保留**有界乱序缓存**（`driver-jsonl.md §7/§8`）。
- 终态判定来源：`terminalResult(history, …)`（M:118250）——按 `history.turns`/`messages` 的 `status` 归一：`failed→error`、`stopped→stopped`、否则 `complete`；并结合 `observedTurnId`/`knownTurnIds`。
- 无完整证据时，顺序保证标 **UNKNOWN 或限定条件**。

## 4. 常量（STATIC_CONFIRMED）
`INFERENCE_ABSOLUTE_TIMEOUT_MS=360000`、`INFERENCE_DRAIN_PROOF_MS=5000`、`INFERENCE_CONFLICT_DELAY_MS=750`、`STOP_DRAIN_TIMEOUT_MS=5000`、`POLL_INTERVAL_MS(headless)=100`。

## 5. UNKNOWN
- 服务端收到 `turn.stop` 内部的真实语义与计费影响。
- 409 分支的完整数据形状（仅知 code/reason/retryable/ambiguous 判定）。
- 终态通知在真实网关下的到达顺序（仅静态断言正常序）。

---

## 6. cancelInference 细节（本轮新增证据，STATIC_CONFIRMED）

- 处理器 `gateway.inference.cancel`（M:36821 → M:37241 `cancelInference(payload, signal)`）。
- 载荷：`{ requestId, streamId }`；两者均为标识符。
- 身份核对：
  - 无 active：`retired.streamId !== streamId` → `stream_not_found`；
  - 有 active：`active.streamId !== streamId` → `stream_mismatch`。
- 行为：`active.deliveryController.abort()`；非 independent → `active.controller.abort()` 且 `semanticTerminalDrain = semanticTerminal !== undefined`；independent → 若无 `semanticTerminal` 则 `deliverySuppressed=true`。
- 排空：`joinInferenceTask(active.task, signal, independent ? INDEPENDENT_REVIEW_DRAIN_TIMEOUT_MS(30000) : INFERENCE_DRAIN_TIMEOUT_MS(2500))`；未 join 或（independent 且无 `semanticTerminal`）→ `{cancelled:false}`（diagnostic `drain_unconfirmed`）。
- 成功后若 `retired.semanticTerminal === "message_end"` 且未记录 → 写入 `drainedInferences[leaseKey] = { requestId, drainedAt: Date.now() }`（容量 256）——**这就是冲突恢复用的 `recoveryProof`**。
- 返回：`{cancelled: true|false}`（永不抛业务外的异常，除身份错误）。
- `semanticTerminal` 来源：推理事件流中首个 `message_end` 或 `error`（M:37831/37857）。
- **不得**由 `{cancelled:true}` 推断服务端已停止计费（UNKNOWN）。
- 纯函数实现与测试：`src/desktop/cancel.mjs`、`tests/desktop/cancel.test.mjs`（MOCK_VERIFIED）。

---

## 7. 范围澄清（L2 §4.4）

- `turn.stop`（运行时 RPC）**当前明确的调用对象是本地运行时**；在缺少后续证据时，**不**直接描述为“远端服务端停止”。
- headless 的 accepted 与终态通知顺序，依据 Promise 回调 + emit + 响应写入分析（见 driver-jsonl.md §8）；保留有界乱序处理；不假定乱序一定发生。
- `tests/desktop/inference-flow.test.mjs` 的合成 body 与模拟顺序**只验证适配器机制**，不能证明真实业务顺序。
- `src/desktop/cancel.mjs` / `recovery.mjs` 为纯判定函数；**不代表**已实现真实网络取消或服务端恢复。
