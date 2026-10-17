# 响应流分析（P3）

- 确认等级：**待验证**（A0 仅观察到状态码；聊天响应内容与流式协议未知）

## 已观察（A0）

| 请求 | 状态 | Content-Type | 说明 |
| --- | --- | --- | --- |
| GET /chat/ | 200 | text/html | 外壳 |
| GET /api/orbit/v1/models | 401 | text/plain | 未登录被拒 |
| GET /api/spacebe/v1/space/list | 401 | text/plain | 未登录被拒 |
| POST aurora.../v1/web/start | 200 | application/json | 初始化响应（内容未解析） |
| GET aurora.../v1/web/tags | 200 | application/json | 同上 |

## 源码可证的响应约定（S-MOCE / S-597）

- `chat/new`：期望 `{code:0, data:{id}}`（源码判断 `0!==a||!s?.id` 即失败）。
- `chat/list`：源码以 `success===true || code===0 || code===200` 且 `data` 存在为成功。
- 出现 `forbidMsg` / `forbidUnauthorizedLoginRedirect` 选项 → 存在**未授权自动跳登录**的统一拦截。

## 未知（必须由 A1/A2 取证）

- 聊天回复的传输类型：普通 JSON / SSE / NDJSON / WebSocket —— **未确认**（已加载脚本中无 `EventSource`/`text/event-stream`，但不足以否定）。
- 事件类型集合（文本增量、完整覆盖、元数据、结束、错误）。
- 增量合并语义与结束/取消语义。
- 停止生成（A5）是取消请求还是本地终止。

> 按手册 §8/§10 纪律：**不预设** `[DONE]`、不预设增量字段名、不预设 SSE。
