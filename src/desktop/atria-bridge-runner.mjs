// src/desktop/atria-bridge-runner.mjs
// JSONL 桥接入口：stdin 每行一个推理请求，stdout 最后一行输出 OpenAI 兼容结果。
// 事件流严格经 gateway-events.mjs::parseGatewayEvent 校验（注意载荷键是 text，
// usage 四字段嵌套在 event.usage 下），取消走 cancel.mjs::cancelInferenceDecision
// 的真实签名，409 冲突走 recovery.mjs 的判定链（仅在 5s 证明窗内重试一次）。
// 每帧事件的校验结果追加到 ASTRA_DATA_ROOT/protocol/{sessionId}.jsonl，
// 供 astra-refactored /protocol 协议观测台读取。

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { parseGatewayEvent } from "./gateway-events.mjs";
import { cancelInferenceDecision, CancelProtocolError } from "./cancel.mjs";
import {
  inferenceConflictCode,
  canRecoverInferenceConflict,
  shouldRetryInferenceConflict,
} from "./recovery.mjs";

function appendProtocolLog(logPath, record) {
  if (!logPath) return;
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.appendFileSync(
    logPath,
    JSON.stringify({ timestamp: new Date().toISOString(), ...record }) + "\n",
    "utf8"
  );
}

const STOP_REASON_TO_FINISH = {
  end_turn: "end_turn",
  tool_use: "stop",
  stop_sequence: "stop",
  max_tokens: "length",
};

async function executeWithRecovery(req, { registerSigterm = true } = {}) {
  const sessionId = req.sessionId || `sess_${Date.now()}`;
  const requestId = req.requestId || `req_${Date.now()}`;
  const dataRoot = process.env.ASTRA_DATA_ROOT || path.resolve(process.cwd(), ".astra_data");
  const protocolLogPath = path.join(dataRoot, "protocol", `${sessionId}.jsonl`);

  let recoveryProof = req.recoveryProof || null; // { drainedAt, requestId }
  let semanticTerminal = null;
  let activeStreamId = null;
  let streamDrained = false;
  const controller = new AbortController();

  const buildCancelDecision = () => {
    // 诚实语义：本地 AbortController 中止不等于服务端已停止。
    // signalAborted=true 时 cancelInferenceDecision 必然返回
    // { cancelled:false, reason:'aborted_or_closed' }，我们如实记录。
    try {
      return cancelInferenceDecision({
        activePresent: activeStreamId !== null && !streamDrained,
        activeStreamId,
        activeIndependent: false,
        activeSemanticTerminal: semanticTerminal,
        retired:
          streamDrained && activeStreamId !== null
            ? { streamId: activeStreamId, semanticTerminal }
            : null,
        requestId,
        streamId: activeStreamId || requestId,
        joined: streamDrained,
        signalAborted: controller.signal.aborted,
        closed: false,
      });
    } catch (err) {
      if (err instanceof CancelProtocolError) {
        return { cancelled: false, reason: err.code };
      }
      throw err;
    }
  };

  if (registerSigterm) {
    process.on("SIGTERM", () => {
      controller.abort();
      const decision = buildCancelDecision();
      appendProtocolLog(protocolLogPath, { kind: "CANCEL_DECISION", decision });
      process.stdout.write(
        JSON.stringify({
          sessionId,
          cancelled: true,
          cancelDecision: decision,
          choices: [
            { index: 0, finish_reason: null, message: { role: "assistant", content: null } },
          ],
        }) + "\n"
      );
      process.exit(0);
    });
  }

  const baseUrl = process.env.INKSTONE_GATEWAY_URL || "http://127.0.0.1:8787";
  const faultParam = req.fault ? `?fault=${encodeURIComponent(req.fault)}` : "";
  const url = `${baseUrl}/api/orbit/v1/local-agent/messages${faultParam}`;

  for (let attempt = 0; attempt < 2; attempt++) {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({
        model: req.model || "Atria-Dawn",
        messages: req.messages,
        temperature: 0.2,
        max_tokens: req.max_tokens || 8192,
      }),
      signal: controller.signal,
    });

    if (resp.status === 409) {
      const errBody = await resp.json().catch(() => ({}));
      const conflictCode = inferenceConflictCode(errBody, "turn");
      const recoverable = canRecoverInferenceConflict({
        recoveryProof,
        requestId,
        now: Date.now(),
      });
      const retry = shouldRetryInferenceConflict({
        code: conflictCode,
        attempt,
        recoverable,
      });
      appendProtocolLog(protocolLogPath, {
        kind: "RECOVERY_409_CHECK",
        attempt,
        conflictCode: conflictCode ?? null,
        recoverable,
        shouldRetry: retry,
      });
      if (retry) continue;
      throw new Error(`Unrecoverable 409 conflict: ${conflictCode ?? "unknown"}`);
    }

    if (!resp.ok) {
      throw new Error(`Gateway HTTP ${resp.status}`);
    }

    let contentText = "";
    let thinkingText = "";
    let stopReason = "end_turn";
    let usageObj = null;

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        streamDrained = true;
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const rawLine of lines) {
        const trimmed = rawLine.trim();
        if (!trimmed.startsWith("data:")) continue;
        const dataStr = trimmed.slice(5).trim();
        if (!dataStr || dataStr === "[DONE]") continue;

        let validationStatus = "pass";
        let validationError = null;
        try {
          // parseGatewayEvent 只接受原始字符串，做精确键集合校验。
          parseGatewayEvent(dataStr);
        } catch (err) {
          validationStatus = "violation";
          validationError = err.message;
        }

        const rawEvent = JSON.parse(dataStr);

        appendProtocolLog(protocolLogPath, {
          kind: "GATEWAY_EVENT",
          event: rawEvent,
          validationStatus,
          validationError,
        });

        // 载荷字段是 text（gateway-events.mjs:50-53），usage 嵌套在 event.usage。
        if (rawEvent.type === "message_start") {
          activeStreamId = rawEvent.response_id || activeStreamId;
        } else if (rawEvent.type === "thinking_delta" && typeof rawEvent.text === "string") {
          thinkingText += rawEvent.text;
        } else if (rawEvent.type === "content_delta" && typeof rawEvent.text === "string") {
          contentText += rawEvent.text;
        } else if (rawEvent.type === "usage" && rawEvent.usage && typeof rawEvent.usage === "object") {
          usageObj = {
            input_tokens: rawEvent.usage.input_tokens ?? null,
            output_tokens: rawEvent.usage.output_tokens ?? null,
            cache_read_tokens: rawEvent.usage.cache_read_tokens ?? null,
            cache_write_tokens: rawEvent.usage.cache_write_tokens ?? null,
          };
        } else if (rawEvent.type === "message_end") {
          semanticTerminal = "message_end";
          stopReason = rawEvent.stop_reason || "end_turn";
        }
      }
    }

    const finalDecision = buildCancelDecision();

    if (finalDecision.recordsRecoveryProof) {
      recoveryProof = { drainedAt: Date.now(), requestId };
    }

    return {
      sessionId,
      cancelDecision: finalDecision,
      recoveryProof,
      protocolLogPath,
      choices: [
        {
          index: 0,
          finish_reason: STOP_REASON_TO_FINISH[stopReason] || "stop",
          message: {
            role: "assistant",
            content: contentText || null,
          },
        },
      ],
      ...(usageObj
        ? {
            usage: {
              prompt_tokens: usageObj.input_tokens,
              completion_tokens: usageObj.output_tokens,
              total_tokens:
                usageObj.input_tokens != null && usageObj.output_tokens != null
                  ? usageObj.input_tokens + usageObj.output_tokens
                  : null,
            },
            protocol_usage: usageObj,
          }
        : {}),
    };
  }
}

export { executeWithRecovery };

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const req = JSON.parse(line);
    try {
      const result = await executeWithRecovery(req);
      process.stdout.write(JSON.stringify(result) + "\n");
    } catch (err) {
      process.stdout.write(
        JSON.stringify({ error: { message: String((err && err.message) || err) } }) + "\n"
      );
      process.exitCode = 1;
    }
    break;
  }
}
