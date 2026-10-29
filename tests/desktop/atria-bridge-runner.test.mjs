// tests/desktop/atria-bridge-runner.test.mjs
// 离线单元测试：桩掉全局 fetch，验证桥接器对 gateway-events 严格校验、
// usage 嵌套取数、cancelInferenceDecision 真实签名与 409 恢复判定链。
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { executeWithRecovery } from "../../src/desktop/atria-bridge-runner.mjs";

function sseResponse(events, { status = 200 } = {}) {
  const body = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
  return new Response(body, { status });
}

const GOOD_EVENTS = [
  { type: "message_start", response_id: "resp-1", model: "Atria-Dawn" },
  { type: "thinking_delta", text: "想" },
  { type: "content_delta", text: "答" },
  { type: "content_delta", text: "案" },
  { type: "usage", usage: { input_tokens: 5, output_tokens: 2, cache_read_tokens: 0, cache_write_tokens: 0 } },
  { type: "message_end", stop_reason: "end_turn" },
];

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-runner-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  process.env.ASTRA_DATA_ROOT = dir;
  return dir;
}

test("正常流：text 载荷拼装 + 嵌套 usage 映射 + 协议日志全 pass", async (t) => {
  const root = tempDataRoot(t);
  await withStubbedFetch(async () => sseResponse(GOOD_EVENTS), async () => {
    const result = await executeWithRecovery(
      { sessionId: "sess_ok", messages: [{ role: "user", content: "hi" }] },
      { registerSigterm: false }
    );
    assert.equal(result.choices[0].message.content, "答案");
    assert.equal(result.choices[0].finish_reason, "end_turn");
    assert.deepEqual(result.usage, { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 });
    assert.deepEqual(result.protocol_usage, {
      input_tokens: 5,
      output_tokens: 2,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
    });
    assert.equal(result.cancelDecision.cancelled, true);
    assert.equal(result.cancelDecision.recordsRecoveryProof, true);

    const logLines = fs
      .readFileSync(result.protocolLogPath, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    const gatewayEvents = logLines.filter((r) => r.kind === "GATEWAY_EVENT");
    assert.equal(gatewayEvents.length, GOOD_EVENTS.length);
    assert.ok(gatewayEvents.every((r) => r.validationStatus === "pass"));
  });
});

test("违规事件被 parseGatewayEvent 标记为 violation", async (t) => {
  const root = tempDataRoot(t);
  const bad = [
    { type: "message_start", response_id: "r2", model: "m" },
    { type: "content_delta", delta: "错误键名" },
    { type: "usage", usage: { input_tokens: 1, output_tokens: 1 } },
    { type: "message_end", stop_reason: "end_turn" },
  ];
  await withStubbedFetch(async () => sseResponse(bad), async () => {
    const result = await executeWithRecovery(
      { sessionId: "sess_bad", messages: [] },
      { registerSigterm: false }
    );
    const logLines = fs
      .readFileSync(result.protocolLogPath, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    const violations = logLines.filter((r) => r.validationStatus === "violation");
    assert.equal(violations.length, 1);
    assert.equal(result.choices[0].message.content, null);
  });
});

test("409001 无恢复凭据：不重试，直接失败并记录判定链", async (t) => {
  tempDataRoot(t);
  const conflict = {
    code: 409001,
    data: { reason: "TURN_CONFLICT" },
  };
  let calls = 0;
  await withStubbedFetch(
    async () => {
      calls += 1;
      return new Response(JSON.stringify(conflict), { status: 409 });
    },
    async () => {
      await assert.rejects(
        executeWithRecovery(
          { sessionId: "sess_409", requestId: "req_409", messages: [] },
          { registerSigterm: false }
        ),
        /Unrecoverable 409 conflict: TURN_CONFLICT_RECOVERY/
      );
      assert.equal(calls, 1);
    }
  );
  const logPath = path.join(process.env.ASTRA_DATA_ROOT, "protocol", "sess_409.jsonl");
  const logLines = fs.readFileSync(logPath, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const check = logLines.find((r) => r.kind === "RECOVERY_409_CHECK");
  assert.equal(check.conflictCode, "TURN_CONFLICT_RECOVERY");
  assert.equal(check.recoverable, false);
  assert.equal(check.shouldRetry, false);
});

test("409001 + 5s 内有效恢复凭据：恰好重试一次并成功", async (t) => {
  tempDataRoot(t);
  const conflict = { code: 409001, data: { reason: "TURN_CONFLICT" } };
  let calls = 0;
  await withStubbedFetch(
    async () => {
      calls += 1;
      return calls === 1
        ? new Response(JSON.stringify(conflict), { status: 409 })
        : sseResponse(GOOD_EVENTS);
    },
    async () => {
      const result = await executeWithRecovery(
        {
          sessionId: "sess_rec",
          requestId: "req_new",
          messages: [],
          recoveryProof: { drainedAt: Date.now() - 100, requestId: "req_old" },
        },
        { registerSigterm: false }
      );
      assert.equal(calls, 2);
      assert.equal(result.choices[0].message.content, "答案");
    }
  );
});

test("409005 retryable=true 被识别为 INFERENCE_LEASE_RECOVERY", async (t) => {
  tempDataRoot(t);
  const conflict = { code: 409005, data: { reason: "INFERENCE_ALREADY_RUNNING", retryable: true } };
  await withStubbedFetch(
    async () => new Response(JSON.stringify(conflict), { status: 409 }),
    async () => {
      await assert.rejects(
        executeWithRecovery(
          { sessionId: "sess_4095", requestId: "req_4095", messages: [] },
          { registerSigterm: false }
        ),
        /INFERENCE_LEASE_RECOVERY/
      );
    }
  );
});

test("429 透传为 HTTP 错误", async (t) => {
  tempDataRoot(t);
  await withStubbedFetch(
    async () => new Response(JSON.stringify({ synthetic: true }), { status: 429 }),
    async () => {
      await assert.rejects(
        executeWithRecovery(
          { sessionId: "sess_429", messages: [] },
          { registerSigterm: false }
        ),
        /Gateway HTTP 429/
      );
    }
  );
});

test("mock-gateway ?fault= 合成信封与本桥接器判定链兼容", async (t) => {
  // 与 tools/mock-gateway.mjs 的故障注入补丁形状对齐：409001 信封必须能被
  // inferenceConflictCode(payload, 'turn') 识别。
  tempDataRoot(t);
  const mockFaultBody = { code: 409001, data: { reason: "TURN_CONFLICT" }, synthetic: true };
  await withStubbedFetch(
    async () => new Response(JSON.stringify(mockFaultBody), { status: 409 }),
    async () => {
      await assert.rejects(
        executeWithRecovery(
          { sessionId: "sess_mockfault", requestId: "req_mf", messages: [] },
          { registerSigterm: false }
        ),
        /TURN_CONFLICT_RECOVERY/
      );
    }
  );
});
