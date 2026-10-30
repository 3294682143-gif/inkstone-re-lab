// tests/desktop/k13-resilience-matrix.test.mjs
// K13 恢复三矩阵单元测试与协议落盘验证（方案 §12.2）
// 覆盖：SSE 断线重连矩阵（T25）、429/5xx 节流矩阵（T21）、409001/409005 冲突矩阵
// 验证 ASTRA_DATA_ROOT/protocol/*.jsonl 中 CANCEL_DECISION 与 RECOVERY_409_CHECK 记录真实落盘

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { executeWithRecovery } from "../../src/desktop/atria-bridge-runner.mjs";

function sseResponse(events, { status = 200, headers = {} } = {}) {
  const body = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/event-stream", ...headers },
  });
}

function withStubbedFetch(impl, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      globalThis.fetch = original;
    });
}

function tempDataRoot(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "k13-matrix-data-"));
  t.after(() => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {}
  });
  process.env.ASTRA_DATA_ROOT = dir;
  return dir;
}

const GOOD_EVENTS = [
  { type: "message_start", response_id: "resp-good-1", model: "Atria-Dawn" },
  { type: "thinking_delta", text: "推理演算..." },
  { type: "content_delta", text: "结论：42" },
  { type: "usage", usage: { input_tokens: 12, output_tokens: 6, cache_read_tokens: 0, cache_write_tokens: 0 } },
  { type: "message_end", stop_reason: "end_turn" },
];

test("【K13 矩阵 1 · T25】SSE 断线重连矩阵：中途异常断流检测与自动重连闭环", async (t) => {
  const root = tempDataRoot(t);
  const brokenEvents = [
    { type: "message_start", response_id: "resp-broken-1", model: "Atria-Dawn" },
    { type: "thinking_delta", text: "半途断线..." },
  ];

  let attemptCount = 0;
  await withStubbedFetch(
    async () => {
      attemptCount++;
      return attemptCount === 1 ? sseResponse(brokenEvents) : sseResponse(GOOD_EVENTS);
    },
    async () => {
      const result = await executeWithRecovery(
        {
          sessionId: "sess_t25_reconnect",
          requestId: "req_t25_1",
          messages: [{ role: "user", content: "断线重连测试" }],
          allowSseReconnect: true,
        },
        { registerSigterm: false }
      );

      assert.equal(attemptCount, 2, "应当在第 1 次异常断流后触发第 2 次重连");
      assert.equal(result.choices[0].message.content, "结论：42");
      assert.equal(result.choices[0].finish_reason, "end_turn");

      // 验证协议日志落盘与重连事件
      const logFile = path.join(root, "protocol", "sess_t25_reconnect.jsonl");
      assert.ok(fs.existsSync(logFile), `协议日志必须真实落盘: ${logFile}`);

      const lines = fs.readFileSync(logFile, "utf8").split("\n").filter(Boolean).map(JSON.parse);
      const reconnectCheck = lines.find((l) => l.kind === "SSE_DISCONNECT_CHECK");
      assert.ok(reconnectCheck, "必须记录 SSE_DISCONNECT_CHECK 事件");
      assert.equal(reconnectCheck.attempt, 0);
      assert.equal(reconnectCheck.shouldReconnect, true);

      const cancelDecision = lines.find((l) => l.kind === "CANCEL_DECISION");
      assert.ok(cancelDecision, "必须记录 CANCEL_DECISION 终态判定");
      assert.equal(cancelDecision.decision.cancelled, true);
    }
  );
});

test("【K13 矩阵 2 · T21】429/5xx 节流与故障矩阵：HTTP 429 速率限制及 Retry-After 日志记录", async (t) => {
  const root = tempDataRoot(t);
  const throttleHeaders = new Headers({
    "Retry-After": "5",
    "x-rpm-limit": "60",
    "x-rpm-remaining": "0",
    "X-Synthetic-Fault": "true",
  });

  await withStubbedFetch(
    async () =>
      new Response(
        JSON.stringify({
          code: 429000,
          data: { reason: "RATE_LIMIT_EXCEEDED" },
          message: "Synthetic 429 injected",
        }),
        { status: 429, headers: throttleHeaders }
      ),
    async () => {
      await assert.rejects(
        executeWithRecovery(
          {
            sessionId: "sess_t21_429",
            requestId: "req_t21_rate",
            messages: [{ role: "user", content: "节流测试" }],
          },
          { registerSigterm: false }
        ),
        /Gateway HTTP 429/
      );

      const logFile = path.join(root, "protocol", "sess_t21_429.jsonl");
      assert.ok(fs.existsSync(logFile), "429 节流事件必须落盘协议日志");

      const lines = fs.readFileSync(logFile, "utf8").split("\n").filter(Boolean).map(JSON.parse);
      const throttleEvent = lines.find((l) => l.kind === "THROTTLE_429_CHECK");
      assert.ok(throttleEvent, "必须记录 THROTTLE_429_CHECK");
      assert.equal(throttleEvent.status, 429);
      assert.equal(throttleEvent.retryAfter, "5");
    }
  );
});

test("【K13 矩阵 2 · T21】429/5xx 节流与故障矩阵：502/503 临时服务端错误日志记录", async (t) => {
  const root = tempDataRoot(t);
  await withStubbedFetch(
    async () => new Response("Bad Gateway", { status: 502 }),
    async () => {
      await assert.rejects(
        executeWithRecovery(
          {
            sessionId: "sess_t21_502",
            requestId: "req_t21_server",
            messages: [{ role: "user", content: "502测试" }],
          },
          { registerSigterm: false }
        ),
        /Gateway HTTP 502/
      );

      const logFile = path.join(root, "protocol", "sess_t21_502.jsonl");
      assert.ok(fs.existsSync(logFile), "502 故障事件必须落盘协议日志");

      const lines = fs.readFileSync(logFile, "utf8").split("\n").filter(Boolean).map(JSON.parse);
      const serverEvent = lines.find((l) => l.kind === "GATEWAY_5XX_CHECK");
      assert.ok(serverEvent, "必须记录 GATEWAY_5XX_CHECK");
      assert.equal(serverEvent.status, 502);
    }
  );
});

test("【K13 矩阵 3 · 409 恢复】409001/409005 冲突矩阵与协议观测台双事件落盘验证", async (t) => {
  const root = tempDataRoot(t);
  const conflictPayload = {
    code: 409001,
    data: { reason: "TURN_CONFLICT" },
    synthetic: true,
  };

  let calls = 0;
  await withStubbedFetch(
    async () => {
      calls++;
      return calls === 1
        ? new Response(JSON.stringify(conflictPayload), { status: 409 })
        : sseResponse(GOOD_EVENTS);
    },
    async () => {
      const result = await executeWithRecovery(
        {
          sessionId: "sess_k13_conflict_obs",
          requestId: "req_k13_conf",
          messages: [{ role: "user", content: "冲突恢复测试" }],
          recoveryProof: { drainedAt: Date.now() - 500, requestId: "req_prior_0" },
        },
        { registerSigterm: false }
      );

      assert.equal(calls, 2);
      assert.equal(result.choices[0].message.content, "结论：42");

      // 核心门禁验证：ASTRA_DATA_ROOT/protocol/*.jsonl 必须同时落盘 RECOVERY_409_CHECK 与 CANCEL_DECISION
      const logFile = path.join(root, "protocol", "sess_k13_conflict_obs.jsonl");
      assert.ok(fs.existsSync(logFile), `观测台日志必须存在: ${logFile}`);

      const lines = fs.readFileSync(logFile, "utf8").split("\n").filter(Boolean).map(JSON.parse);
      const check409 = lines.find((l) => l.kind === "RECOVERY_409_CHECK");
      const cancelDec = lines.find((l) => l.kind === "CANCEL_DECISION");

      assert.ok(check409, "协议日志必须包含 RECOVERY_409_CHECK 记录");
      assert.equal(check409.conflictCode, "TURN_CONFLICT_RECOVERY");
      assert.equal(check409.recoverable, true);
      assert.equal(check409.shouldRetry, true);

      assert.ok(cancelDec, "协议日志必须包含 CANCEL_DECISION 记录");
      assert.equal(cancelDec.decision.cancelled, true);
      assert.equal(cancelDec.decision.recordsRecoveryProof, true);
    }
  );
});
