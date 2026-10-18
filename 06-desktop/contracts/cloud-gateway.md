# 桌面端 cloud gateway 契约（0.2.7）

- 来源：Windows 安装包 `inkstone-desktop-0.2.7-setup.exe` → `$PLUGINSDIR/inkstone-app.7z` → `resources/app.asar`
- 证据文件（未格式化）：`out/main/index-CYl10ENn.js`（下称 **M**），SHA256 `f4b8148db01e9a196c28dd68d94761d715b834ee2fec3af861fe8ddec665acab`
- 确认等级：STATIC_CONFIRMED（行号基于上述哈希的原始文件；换包/prettify 后需重新定位）
- 与 Web 基线的关键区别：桌面用独立协议（`/local-agent/*`），事件字段为 `type`，正常结束为 `message_end`

## 1. 基址与配置（M:3784 / M:4828 / M:4842）

| 项 | 值 |
| --- | --- |
| Core API 基址 | `https://discovery.intern-ai.org.cn/api/orbit/v1`（M:4842 `coreApiBaseUrl`） |
| 通用 API 基址 | `https://discovery.intern-ai.org.cn/api` |
| 认证 API 基址 | `https://discovery.intern-ai.org.cn/api/user-center/v1` |
| SCPHub API | `https://discovery.intern-ai.org.cn/api/moce/v1` |
| 更新基址 | `https://static.openxlab.org.cn/releases/inkstone`（M:4828） |
| SSO | origin `https://sso.openxlab.org.cn`，client_id `dagw07mkg1bazlxzoy31`，source `discovery` |

## 2. 端点

| 端点 | 方法 | 说明 | 证据 |
| --- | --- | --- | --- |
| `/chat/new` | POST | 创建会话；桌面体 `{scenario:2,type:0,provider:0,agent:"local_agent"}`；返回 `data.id`（正整数） | M:36948 `createConversation` |
| `/chat/{chatId}/title` | POST | 生成/设置标题 | M:36948 附近 |
| `/chat/{chatId}` | POST/DELETE | 重命名 / 删除（删除 404 视为成功） | 同上 |
| `/local-agent/models` | GET | 模型能力目录 | M:37075 |
| `/local-agent/messages` | POST | **主要推理路径**，SSE | M:37727 |
| `/chat/{chatId}/local-turns` | POST | 轮次开始（conversation.start） | M:38034/38037 |
| `/chat/{chatId}/local-turns/{turnId}/checkpoint` | POST | 轮次检查点 | M:38045/38049 |
| `/chat/{chatId}/local-turns/{turnId}/complete` | POST | 轮次完成（含 usage） | M:38059/38063 |

## 3. 请求身份（M:38165 起 `headers()`）

```
Authorization: Bearer <authority.token>
id: <authority.ssoUid>
Accept-Language: <authority.locale>
Content-Type: application/json   （有 body 时）
Accept: application/json | text/event-stream
```

- 请求选项：`redirect:"error"`, `cache:"no-store"`, **`credentials:"omit"`**（M:38102-38105）。
  → **不套用 Web 的 Cookie 方案**；桌面主链身份靠 Bearer 头。STATIC_CONFIRMED。

## 4. 推理请求体（M:37138 / M:37727）

- `providerRequest` 由 payload 派生（含 `messages`/`tools`），发送前 **删除内部字段 `lifecycle_owner`**（M:37138 起）。STATIC_CONFIRMED。
- 请求 `Accept: text/event-stream`。

## 5. 响应封装与错误（M:38110-38180 `requestJsonURL`）

- 非 SSE 的 JSON 封装：`{msg, trace_id, code, data}`；要求 `msg`/`trace_id` 为字符串。
- 成功：`code === 0 || code === 200` 且存在 `data`。
- `401` 或 `authenticationExpired(payload)` → 认证失败回调 → 抛 `authentication_required`。
- `notFoundIsSuccess && status===404 && code===404` → 视为成功（用于 DELETE）。

## 6. 推理事件协议（M:38554 `GatewayEventSequence`、M:38593 `parseGatewayEvent`）

- 帧：SSE `data: <JSON>`；类型在 JSON 的 **`type`** 字段。
- 类型与字段（exactKeys 校验）：

| type | 字段 |
| --- | --- |
| `message_start` | `type,response_id,model` |
| `thinking_delta` | `type,text` |
| `content_delta` | `type,text` |
| `tool_use_start` | `type,id,name` |
| `tool_input_delta` | `type,id,partial_json` |
| `tool_use_end` | `type,id,input?` |
| `usage` | `type,usage{input_tokens,output_tokens,cache_read_tokens?,cache_write_tokens?}` |
| `message_end` | `type,stop_reason` ∈ `end_turn\|tool_use\|max_tokens\|stop_sequence` |
| `error` | `type,code,message,retryable` |

- 序列规则（STATIC_CONFIRMED）：
  1. 必须以 `message_start` 开始；
  2. `usage` 至多一次；
  3. `usage` 之后只允许 `message_end`；
  4. `message_end` 之前必须出现 `usage`；
  5. `error` 视为终止；结束后不得再有事件；
  6. 流结束必须已有终止事件，否则报错。

## 7. 轮次持久化（M:38034-38063）

| 调用 | 请求 | 返回（校验） |
| --- | --- | --- |
| conversation.start | `POST /chat/{chatId}/local-turns`，body=payload.body | `turn_id, message_id, status, checkpoint_seq` |
| conversation.checkpoint | `POST .../{turnId}/checkpoint` | `applied(bool), status, checkpoint_seq` |
| conversation.complete | `POST .../{turnId}/complete` | `turn_id, message_id, status, checkpoint_seq, usage{input_tokens,output_tokens,cache_read_tokens?,cache_write_tokens?}` |

## 8. 停止（M:56774 / M:56974 / M:118477）

- RPC `turn.stop`（`supervisor.callRuntime("turn.stop", ...)`）与 headless `turn.stop` 方法。
- 存在 gateway `inference.cancel` 与 drain 分支；**动态语义（停止后状态收敛、是否影响云端计费）未验证 → UNKNOWN**。

## 9. 与图像分析支路的区别

- 包内仍有 `/chat` + `workflow_finished`（`event` 字段）的**图像分析**支路，**不是**桌面聊天主链；不得混用。STATIC_CONFIRMED（结构差异）。

## 10. UNKNOWN（需动态或更多静态）

- `/local-agent/messages` 的完整业务字段集合（messages/tools 结构）细节；
- 轮次 `body` 的内部字段（由上层 payload 决定）；
- 停止后状态收敛与计费影响；
- 冲突恢复（409 + `inferenceConflictCode`）的具体分支（M 有 recovery 逻辑，未展开）。
