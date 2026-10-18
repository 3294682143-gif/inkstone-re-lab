# 桌面端证据索引（0.2.7）

- 样本 SHA256：`eb8ef2da7c67df4fd2728a686cf84c1699fa410746af2d5b08f6e9b89d6dfcd8`
- 主 bundle（简写 M）：`out/main/index-CYl10ENn.js`，SHA256 `f4b8148db01e9a196c28dd68d94761d715b834ee2fec3af861fe8ddec665acab`
- 原始件在 `01-evidence/private/desktop-027/`（不入库）；本文只登记脱敏片段。

## 片段（06-desktop/evidence/snippets/）

| 文件 | 源位置（M 行号） | 支持结论 |
| --- | --- | --- |
| chat-new-scenario2.txt | M:36935-36995 | `/chat/new` 桌面体 `scenario:2,type:0,provider:0,agent:"local_agent"`；标题/重命名/删除 |
| models.txt | M:37060-37145 | `GET /local-agent/models`；`parseCapabilities` 调用；推理发起与 `lifecycle_owner` 删除 |
| messages-request.txt | M:37720-37810 | `POST /local-agent/messages`；`Accept: text/event-stream`；错误处理与冲突恢复 |
| conversation-sync.txt | M:38020-38100 | `local-turns` / `checkpoint` / `complete` 字段 |
| gateway-events.txt | M:38554-38660 | `GatewayEventSequence`、`parseGatewayEvent` 各 `type` 字段 |
| headers-auth.txt | M:38100-38180 | 身份头 `Authorization/id/Accept-Language`、`credentials:"omit"`、封装 `{msg,trace_id,code,data}` |
| headless-1.txt | M:118351-118420 | 协议常量、driver.ready、错误码、请求上限 |
| headless-2.txt | M:118820-118900 | `parseRequest`（仅 id/method/params）、`publicSession` |
| headless-3.txt | M:119000-119045 | `SSO_REQUIRED`（headless 登录前提） |
| headless-methods.txt | M:118490-118700 | driver 方法：session/turn/stop/history/approval；`turn.send` 返回 `accepted:true` |
| listmodels-runtime.txt | M:56200-56260 | runtime `listModels` |
| stop-turn.txt | M:56770-56810 | `turn.stop` RPC |

## 哈希清单

- 完整 ASAR 清单：`evidence/asar-manifest.json`（6035 条目 / 181 提取）
- 样本与运行时哈希：`evidence/sample-manifest.json`

## 纪律

- 所有桌面结论默认 `STATIC_CONFIRMED`；运行行为标 `UNKNOWN`。
- 不执行安装器/应用/原生程序；不向目标平台发请求；不做 Authenticode 验签。
- 未解释的 URL/字符串不当作运行中接口。
