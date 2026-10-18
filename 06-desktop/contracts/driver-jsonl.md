# Headless driver JSONL 契约（0.2.7）

- 证据：`M = out/main/index-CYl10ENn.js`（`f4b8148d…`），`M:118351` 起 `HeadlessChatDriver`、`M:118833` `parseRequest`、`M:119018` `SSO_REQUIRED`
- 入口（`out/main/index.js:161`）：`INKSTONE_HEADLESS_CHAT=1` / `INKSTONE_HEADLESS_CHAT_DRIVER=1` 或参数 `--headless-chat` / `--headless-chat-driver`
- 确认等级：STATIC_CONFIRMED

## 1. 协议头

- 协议版本：`inkstone-headless-chat/v1`（`HEADLESS_CHAT_PROTOCOL_VERSION`）。
- 传输：stdin/stdout **JSON Lines**（每行一个 JSON）。
- 上限：单请求 ≤ 256 KiB（`MAX_REQUEST_BYTES`）；输出 ≤ 4 MiB；会话 ≤ 16；默认轮超时 5 分钟。

## 2. 请求（严格，仅三键）

```json
{"id":"models-1","method":"models.list","params":{}}
```

- `parseRequest` 用 `exactKeys([id,method,params])` 校验：**不得**追加 `jsonrpc` 字段。
- `id`、`method`：字符串，长度 ≤ 128；`params`：对象（缺省 `{}`）。

## 3. 方法

`projects.list`、`models.list`、`session.create`、`session.open`、`session.inspect`、`session.close`、`turn.send`、`turn.stop`、`history.get`、`approval.list`、`approval.respond`、`system.shutdown`。

## 4. 输出

- 响应：`{id, ok:true, result}` 或 `{id, ok:false, error}`。
- 通知（无 id）：`driver.ready`（params.protocol_version）、`turn.completed`、`turn.failed`、`cleanup.warning`。
- 错误码示例：`HEADLESS_INVALID_JSON`、`HEADLESS_INVALID_REQUEST`、`HEADLESS_REQUEST_TOO_LARGE`、`HEADLESS_DRIVER_SHUTTING_DOWN`、`SSO_REQUIRED`、`HEADLESS_TURN_ACTIVE`、`HEADLESS_TURN_TIMEOUT`。

## 5. 关键语义（STATIC_CONFIRMED）

- `turn.send` 返回 `{accepted:true, session_ref, request_id}`——**仅表示已受理，不是完成**；完成来自异步通知 `turn.completed`（`M:118566` 起）。`turn.completed`/`turn.failed` 按 `session_ref`/`request_id` 关联。
- `session.create` 的 `cleanup` 默认 `true`（关闭可能删除测试会话）；取证应显式 `cleanup:false`（`M:118495` 起，`publicSession` 含 `cleanup`）。
- `history.get` 返回 `{session_ref, active_request_id, messages[]}`，消息含 `request_id`/`turn_id`（`M:118674` 起）。
- `turn.stop` 需 `session_ref`+`request_id`。
- **登录前提**：`createHeadlessChatHost.assertAuthenticated` 要求 `auth.getState().status === "authenticated"`，否则抛 `SSO_REQUIRED`（`M:119018`）。即须在同一系统用户下先用桌面应用完成登录；不是要求导出 Token。

## 6. UNKNOWN / Windows 实机

- 真实启动、`driver.ready` 实测、`projects.list`/`models.list` 实返、`turn.completed` 实序列：**BLOCKED / ENV_WINDOWS_REQUIRED**（Linux 无法运行 Windows PE）。
- 本轮 Linux 侧以 mock 子进程/注入行验证解析与关联（见 `tests/desktop/driver-jsonl.test.mjs`）。
