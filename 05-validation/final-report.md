# 分析与验证报告

- 日期：2026-10-17
- 目标：https://discovery.intern-ai.org.cn/chat/
- 手册：《Intern InkStone：DSH Web 分析执行手册》v1.0
- 项目目录：`/home/ma-user/work/rea/inkstone-re-lab`

## 已验证结果（验收等级）

| 等级 | 是否达到 | 说明 |
| --- | --- | --- |
| 已观察 | ✅ | A0–A4 真实请求/响应/事件已捕获 |
| 样本验证 | ✅ | 用脱敏 SSE 样本跑通解析器（10 项断言全过） |
| **新会话验证** | ✅ | 最小客户端新建会话 + 追问，**3 组独立会话 ×2 轮**均成功 |
| 独立实现验证 | ✅（部分） | 聊天发送/解析已脱离浏览器；A5/A6 未覆盖 |

## 证据索引

| 结论 | 证据编号 | 文件位置 | 确认等级 |
| --- | --- | --- | --- |
| 未登录 401 / 登录 200 | R002/R003 + login-check | 01-evidence/sanitized/ | 已观察 |
| 发送端点与 SSE | A1/A2 | 01-evidence/sanitized/a1a2-summary.json | 已观察 |
| 事件协议（类型/字段/结束） | A1/A2 | 04-contracts/event-protocol.md | 已观察 |
| 会话级 vs 消息级 | A3 | 01-evidence/sanitized/a3a4-summary.json | 已观察 |
| 历史恢复 | A4 | 同上 | 已观察 |
| 解析器正确性 | 单元测试 | tests/stream-parser.test.mjs | 样本验证 |
| 最小客户端（新会话+追问） | live 运行 | 05-validation/live-validation.md | 新会话验证 |
| 3 组回归 | regression | 05-validation/regression.json | 新会话验证 |

## 接口与协议

- 见 `04-contracts/api-contract.md`（chat/new、chat(SSE)、chat/{id}/title、workspace/{id}/files、models、space/list）。
- 见 `04-contracts/event-protocol.md`（workflow_started→message*→message_end→followup→workflow_finished；`answer`/`thinking` 增量；无 `[DONE]`）。

## 实现与运行

- `src/stream-parser.mjs`：UTF-8 流式 SSE 解析 + 增量合并（未知事件不破坏状态）。
- `src/build-chat-request.mjs`：请求体构造（禁止复用固定 ID）。
- `src/client.mjs`：最小客户端（`--help`/`--dry-run`/`--fixture`/`--live`）。
- `src/regress.mjs`：3 组回归。
- 采集：`src/collect.mjs`、`src/a1_send.mjs`、`src/capture_chat.mjs`、`src/a3a4.mjs`、`src/verify_login.mjs`。
- 运行：Node 内置 `node --test`（无额外依赖）；`node src/client.mjs --help`。
- **不包含任何可用凭证**；凭证仅存在于 `01-evidence/private/`（gitignore）。

## 验证结果

| 场景 | 时间 | 结果 | 证据 | 限制 |
| --- | --- | --- | --- | --- |
| A0 未登录初始化 | 2026-10-17 | 56 请求，接口 401 | a0-network.json | — |
| 登录态校验 | 2026-10-17 | 401→200 | login-check.json | — |
| A1 首轮 | 2026-10-17 | 200 SSE，answer=OK | a1a2-raw.json | — |
| A2 追问 | 2026-10-17 | 复述标记 | a1a2-raw.json | — |
| A3 新会话 | 2026-10-17 | 新 id 1018771 | a3a4-summary.json | — |
| A4 刷新恢复 | 2026-10-17 | detail 200 | a3a4-summary.json | — |
| P5 客户端新会话+追问 | 2026-10-17 | 成功 | live-validation.md | — |
| P6 回归 3×2 | 2026-10-17 | 全 OK | regression.json | — |

## 仍然存在的依赖与未知项

- 鉴权依赖本人登录态（storageState）；过期需重新导出。
- 出网依赖本机代理 127.0.0.1:9999。
- 未验证：A5 停止语义、A6 选项映射、错误流形态、附件、分享/删除等（第一轮外）。
- 反混淆/加密：未发现需 `rev_crypto_calc` 的算法（仅覆盖已加载脚本）。
- 环境限制：deepspider/`rev_*`（DSH Web UI 工具）无法非交互驱动，未使用；静态分析用 ripgrep 完成。

## 后续维护

- 站点前端更新后需重新采集：`/api/orbit/v1/chat` 字段、SSE 事件类型、auth 头形态。
- 可复用：`src/stream-parser.mjs` + `tests/`（协议不变即可复用）。
- 凭证轮换：覆盖 `01-evidence/private/inkstone-auth.json`。

---

## 本轮修复轮更新（2026-10-17）

> 历史报告保留不变。本轮修复了 4 个缺陷并完成离线+在线验收。

- 修复：依赖可复现（package.json/lock/README、移除 DSH 硬编码、代理可选）；`--dry-run/--live` 冲突拒绝；不完整流与业务错误判失败；回归判定加固（含 `--out`）。
- 离线：`node --test` 27/27 通过；全新副本 `npm ci` 后可复现。
- 在线：3 组×2 轮全部通过（会话 1021107/1021113/1021117，`allOk=true`，exit 0）。
- 详见 `05-validation/round2-fix-20261017.md`。
- 未完成：A5/A6；错误流形态未知；DeepSpider/`rev_*` 未使用。
