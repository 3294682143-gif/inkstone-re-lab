# 事件协议（P2）

- 更新日期：2026-10-17
- 依据：A1/A2 实测 SSE 流（会话 1018682，登录态）
- 确认等级：**已观察**
- 原始样本：`01-evidence/private/a1a2-raw.json`（含 body，仅本地）；脱敏样本 `fixtures/`

## 传输

- 端点：`POST /api/orbit/v1/chat`
- 响应 `Content-Type: text/event-stream`
- **帧格式**：以空行分隔的事件块；每块为一行 `data: <JSON>`（**未使用 `event:` 行**，事件类型在 JSON 的 `event` 字段内）
- **编码**：UTF-8（注意：Playwright `response.text()` 可能按 cp1252 解码导致乱码，须按字节 UTF-8 读取）
- **无 `[DONE]` 标记**（与手册 §10 的告诫一致）

## 事件序列（实测）

```
workflow_started
message            (1..N，增量)
message_end
followup
workflow_finished   ← 结束
```

## 事件与字段

| 事件 `event` | 字段 | 类型 | 含义 | 合并方式 |
| --- | --- | --- | --- | --- |
| `workflow_started` | `cid`,`mid` | number | 会话 id / 消息 id | — |
| `message` | `thinking` | string | **思考增量** | 追加 |
| `message` | `answer` | string | **回答增量** | 追加 |
| `message` | `thinking_duration` | number | 思考时长 | 覆盖/参考 |
| `message` | `cid`,`mid` | number | 会话/消息 id | — |
| `message_end` | `cid`,`mid` | number | 本条消息结束 | — |
| `followup` | `followup` | array[{text,type,extra}] | 推荐追问 | — |
| `workflow_finished` | `cid`,`mid` | number | 整个流程结束（终止标记） | — |

- `cid` = 会话 id（实测 1018682，A1/A2 相同）
- `mid` = 消息 id（A1=1270400，A2=1270440，逐轮递增）

## 合并语义

- **`answer` 与 `thinking` 均为增量（delta）**，需按顺序拼接。
- 结束语义：**`workflow_finished`**（非 `[DONE]`、非空行终止）。

## 实测文本核验

- A1：`answer` 拼接 = `OK`；`thinking` 拼接以“用户要求我只回复"OK"…”开头。
- A2：`answer` 拼接 = `您上一条消息中的测试标记是：**INKSTONE-RE-A1**。` → 证明**上下文关联有效**。

## 未知

- 错误结束事件的形态（需人为触发）—— U4/U7。
- `thinking_mode`/`planning_mode`/`model` 与事件内容的映射 —— U9（A6）。
- 取消时的收尾事件 —— U7（A5）。


---

## 源码级修正（2026-10-20）

- 证据：`01-evidence/sanitized/web-chat-module-source-20261020.json` S4（MOCE 聊天模块 @514689）
- 修正：**终态事件不止 `workflow_finished`**。实际代码把以下 5 个都当终态：
  `message_end` / `done` / `close` / `error` / `workflow_finished`
- 影响：客户端判定"本轮结束"时不能只等 `workflow_finished`；收到任一终态即应收尾。
- 提交体与停止语义另有源码证据（S1/S3），见 `04-contracts/api-contract.md` 的 R3 章节。
