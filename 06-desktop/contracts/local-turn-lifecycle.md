# local-turn 生命周期与标识符（桌面 0.2.7）

- 证据：**M** = `out/main/index-CYl10ENn.js`（`f4b8148d…`）
- 证据等级：STATIC_CONFIRMED（接收端字段与 URL/校验）/ INFERRED（生成端）/ UNKNOWN（请求体构造来源）
- 片段：`snippets-r2/B-*.txt`、`snippets/conversation-sync.txt`

## 1. 端点与请求

| 方法 | 路径 | 请求体 | 响应（校验） |
| --- | --- | --- | --- |
| conversation.start | `POST /chat/{chatId}/local-turns` | 调用方提供的 `body`（透传） | `turn_id, message_id, status, checkpoint_seq` |
| conversation.checkpoint | `POST /chat/{chatId}/local-turns/{turnId}/checkpoint` | 透传 `body` | `applied(bool), status, checkpoint_seq` |
| conversation.complete | `POST /chat/{chatId}/local-turns/{turnId}/complete` | 透传 `body` | `turn_id, message_id, status, checkpoint_seq, usage{input_tokens,output_tokens,cache_read_tokens?,cache_write_tokens?}` |

- 处理器：M:38034-38063；`status` 经 `turnStatus()` 校验，合法值 `running|complete|stopped|error`（M:39110）。
- **请求体构造来源未定位** → body 具体字段 **UNKNOWN**（本仓库离线模块对 body 仅做“对象”透传，不虚构字段）。

## 2. 标识符关系表

| 标识符 | 由哪端生成 | 首次出现 | 后续使用 | 必填/一致性 |
| --- | --- | --- | --- | --- |
| `chatId` | 服务端（`POST /chat/new` 返回 `data.id`，正整数） | 创建会话 | local-turns URL、history、turn.stop 目标 | 必填；正整数 |
| `request_id` | 客户端/运行时（`host.createId()`，M:117999） | `turn.send` 的 accepted 响应 | 关联 `turn.completed`/`turn.failed`；`turn.stop` 请求体 | 必填；同回合恒等 |
| `turn_id` | 服务端/本地回合 | start 响应 `turn_id`；事件 `turn_id` | checkpoint/complete URL；`turn.stop.expectedTurnId`；history | 标识符 `^[A-Za-z0-9_-]{1,160}$`（M:31182）；回合内恒等 |
| `message_id` | 服务端 | start/complete 响应 | 反馈/引用定位 | 正整数 |
| `checkpoint_seq` | 服务端 | start/checkpoint/complete 响应 | 检查点序列 | 非负整数；单调参考 |
| `usage` | 服务端 | complete 响应 | 计费/统计 | `input/output` 非负；`cache_*` 可选 |

> 关系：`chatId`(1) → 多 `turn_id`；(chatId, turn_id) → 一个 `request_id` 关联的推理；每个 turn 完成时携带 `message_id` 与 `checkpoint_seq`。

## 3. 检查点/完成/usage 形成

- checkpoint：服务端返回 `applied` + `status` + `checkpoint_seq`；`applied=false` 表示本次未应用（INFERRED：重试/去重语义）。
- complete：返回终态 `status` 及累计 `usage`。
- 停泊（projection）：`ready.projection.stopTurn(requestId)` 更新本地投影（M:56803）。

## 4. 重复提交 / 版本冲突

- 客户端以 `request_id` 去重：runtime `active`/`retired` 已含该 id → `duplicate_request`（推理层，M:37133）。
- 本地投影：同一会话已有运行中的 turn → `conflict("A turn is already running in this conversation")`（M:31180）。
- 服务端冲突码（HTTP 409）见 `cancel-recovery.md`。

## 5. 证据等级
- 端点/响应字段/状态枚举/标识符格式：**STATIC_CONFIRMED**。
- `request_id` 生成端：INFERRED（`host.createId()` 与 `turn.send` 回传一致）。
- 请求体字段：**UNKNOWN**（无构造来源证据，不猜测）。
