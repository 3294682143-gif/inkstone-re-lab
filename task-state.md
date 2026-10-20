# Task State

- 当前阶段：**P6（回归与交付）— 完成**（A5/A6 明确未做）
- 最近更新时间：2026-10-17
- 浏览器会话标识：`headless-patchright-chromium-1248`（登录态经 storageState 注入；不记录凭证）
- 最近一次通过的验收：**新会话验证**（P5：最小客户端新建+追问；P6：3×2 回归）
- 项目根目录：`/home/ma-user/work/rea/inkstone-re-lab`
- 手册：`/home/ma-user/work/rea/Intern-InkStone-DSH-Execution-Runbook.md`

## 阶段状态

| 阶段 | 状态 | 说明 |
| --- | --- | --- |
| P0 环境自检 | ✅ | 模型请求/浏览器读取/网络记录通过；依赖已装 |
| P1 正常操作与网络证据 | ✅（A0–A4） | A5/A6 未做 |
| P2 接口与事件契约 | ✅ | 04-contracts/{api-contract,event-protocol}.md |
| P3 关键 JS 定位 | ✅（静态） | 03-analysis/*；rev_* 不可用，用 ripgrep |
| P4 离线实现与测试 | ✅ | 解析器+构造器，`node --test` 10 通过 |
| P5 最小客户端与新会话验证 | ✅ | src/client.mjs，new+follow-up 成功 |
| P6 回归与交付 | ✅ | 05-validation/* |

## 证据索引

| 编号 | 文件 | 结论 |
| --- | --- | --- |
| E01 | 00-scope/environment.md | 版本/网络/修复/依赖 |
| E02 | 00-scope/tool-inventory.md | 工具清单 |
| E07 | 01-evidence/sanitized/a0-network.json | A0 未登录 56 条 |
| E08 | 01-evidence/sanitized/login-check.json | 登录恢复 401→200 |
| E10 | 01-evidence/sanitized/a1a2-summary.json | A1/A2 发送+SSE |
| E11 | 01-evidence/sanitized/a3a4-summary.json | A3 新会话 / A4 恢复 |
| E12 | 04-contracts/api-contract.md | 接口契约 |
| E13 | 04-contracts/event-protocol.md | 事件协议 |
| E14 | 03-analysis/source-index.md | 端点常量表/发送流 |
| E15 | tests/stream-parser.test.mjs | 10 项断言通过 |
| E16 | 05-validation/live-validation.md | P5 实网验证 |
| E17 | 05-validation/regression.json | P6 3×2 回归 |
| E18 | 05-validation/final-report.md | 最终报告 |

## 未知与遗留

| # | 问题 | 状态 |
| --- | --- | --- |
| B1/B2/B3/B4 | profile/命令/浏览器 | 已解决 |
| B5 | 登录态 | 已解决（storageState） |
| B7 | deepspider/rev_* 非交互不可驱动 | 未解决（架构限制，未使用） |
| U7 | 停止生成语义（A5） | 未取证 |
| U9 | 选项→字段映射（A6） | 未取证 |
| — | 错误流/取消收尾事件 | 未知 |

## 下一项最小动作（如需继续）

- 若需 A5/A6：在登录态下对聊天页操作「停止」/切换模型并采集。
- 如需覆盖更多功能（附件/分享）：新增场景采集。

---

## 修复轮（2026-10-17）

- 基线提交：`bdf3ebba93843be1a0234b5fe00f4d0af3d635fb`
- 代码版本：本轮提交（见 git log）
- 状态：**P0–P6 已通过（离线 + 在线）；A5/A6 未完成**

### 已完成
- 缺陷 1 依赖/环境可复现：`package.json`+`package-lock.json`+`README.md`；`undici` 改为项目依赖；移除所有 DSH 绝对路径；代理仅在显式配置时启用。
- 缺陷 2 参数冲突拒绝：`src/args.mjs` + `src/client.mjs`；`--dry-run --live` 退出 2、零网络、不读凭据。
- 缺陷 3 严格校验：`src/chat-session.mjs`；HTTP/Content-Type/业务/`workflow_finished`；缺结束判失败；超时与清理。
- 缺陷 4 回归加固：`src/regress.mjs`；`--n` 校验、标记纳入判定、会话去重与一致性、非零退出、`--out`。
- 离线测试：27 项通过（原 10 + 新 17）。
- 全新副本验证：`npm ci`/`npm test`/`--help`/`--dry-run --fixture` 均符合预期。
- 在线验收：3 组×2 轮，`allOk=true`，exit 0；结果 `05-validation/accept-20261017T140842Z/regression.json`。

### 未完成 / 阻塞
- A5 停止生成、A6 模型/选项切换：未取证。
- 错误流/取消收尾事件形态：未知。
- DeepSpider / `rev_*`：未使用。

### 下一项最小动作
- 如需 A5/A6：登录态下对页面操作「停止」/切换模型并采集。

---

## 桌面端接续轮（2026-10-18，Linux 静态）

- 基线提交：`126f58dc330e8e0d1ac4f7cd8b3d5a943da5da6e`
- 样本：`inkstone-desktop-0.2.7-setup.exe`，SHA256 `eb8ef2da…`（与文档一致）
- 环境：Linux；未运行 Windows 程序、未用 Xvfb/桌面、未改平台检查、未用 Wine

### Web 未完成项（保持未完成）
- Web A5 停止生成、A6 模型/选项切换：未取证。
- Web 在线验证有现成环境可继续；证据单独归 Web。

### 桌面阶段状态
| 阶段 | 状态 |
| --- | --- |
| P6.1 基线收尾 | PASS（fixture flush 用同一 parser；regress 写入失败非零退出） |
| P7 桌面静态地图 | PASS（STATIC_CONFIRMED；哈希/行号见 06-desktop/evidence） |
| P8 Linux 离线实现 | PASS（src/desktop/* + tests/desktop/*，32 项全绿） |
| P10 原生静态补充 | PARTIAL（构建信息/字符串/职责；RPC 细节 UNKNOWN） |
| P9 Windows 动态闭环 | BLOCKED / ENV_WINDOWS_REQUIRED |
| 桌面 gateway 在线验证 | NOT_RUN / AUTH_REQUIRED |

### 测试基线
- `node --test` → 61/61 通过；`node --test tests/desktop/*.test.mjs` → 32/32。
- 离线测试零网络；桌面模块不 import electron。

### 证据/交付
- 解包与哈希：`06-desktop/evidence/`；契约：`06-desktop/contracts/`；结果：`06-desktop/validation/2026-10-18-linux-static/results.json`；读我：`06-desktop/README.md`。
- 实现：`src/desktop/{gateway-events,driver-jsonl,models-contract,cloud-adapter}.mjs`；样本：`fixtures/desktop/*.synthetic.*`。
- 原始包/完整源码/工具在 `01-evidence/private/desktop-027/`（不入库）。

---

## 桌面协议修复轮（2026-10-19，Linux 离线）

- 审查基线提交：`f4ce887074c6e168c038ec03d08a0bfd6ff39ff4`
- 源码版本：工作区改动（尚未提交）
- 范围：五项缺陷的复现/修复/测试/文档；无登录态、无真实 API、无 Windows

### 五项修复（均 PASS，离线）
| 缺陷 | 文件 | 测试 |
| --- | --- | --- |
| P1 DriverCorrelator 终态/关联 | src/desktop/driver-jsonl.mjs | tests/desktop/driver-jsonl.test.mjs |
| P1 cloud timeout/abort 生命周期 | src/desktop/cloud-adapter.mjs | tests/desktop/cloud-adapter-lifecycle.test.mjs |
| P2 local-turn 响应契约校验 | src/desktop/cloud-adapter.mjs | tests/desktop/local-turn-contract.test.mjs |
| P2 GatewayStreamMerger.reset | src/desktop/gateway-events.mjs | tests/desktop/gateway-reset.test.mjs |
| P2 ASAR 提取命令冲突 | 06-desktop/README.md, tools/compare_asar_manifest.py | tests/desktop/asar-tools.test.mjs |

- 修复前（stash 回退 src）：desktop tests 57 / 22 失败（lifecycle 用例在基线代码下挂起）。
- 修复后：`node --test tests/desktop/*.test.mjs` 62/62；`npm test` 91/91。
- 证据：`06-desktop/validation/2026-10-19-five-fixes/results.json`。

### 仍未验证（如实）
- P9 Windows 动态：BLOCKED / ENV_WINDOWS_REQUIRED。
- 桌面 gateway 在线：NOT_RUN / AUTH_REQUIRED。
- 真实安装包重提取：NOT_RUN（本轮仅以合成 fixture 验证脚本逻辑）。
- Web A5/A6：NOT_RUN。
- Linux mock 通过 ≠ Windows 桌面实测通过。

---

## 桌面协议 R1–R4 轮（2026-10-18T13:44:50Z，Linux 离线 + 最小 LIVE）

- 审查基线：`76294a8bff8cbc40981dd66c0d444beebf9691d6`
- 源码版本：工作区改动（本轮提交见 git log）
- 环境：Linux / Node v24.7.0 / Python 3.10.6

### R1（三个缺陷修复 — 全部 PASS，离线）
| 缺陷 | 文件 | 测试 |
| --- | --- | --- |
| A DriverCorrelator 严格关联（session_ref/方法/类型/turn_id/isAccepted） | src/desktop/driver-jsonl.mjs | tests/desktop/driver-jsonl.test.mjs |
| B safeCancel 兑现有界等待 + releaseLock（子进程） | src/desktop/cloud-adapter.mjs | tests/desktop/cloud-adapter-lifecycle.test.mjs |
| C 非 SSE 错误响应不吞取消/超时 | src/desktop/cloud-adapter.mjs | tests/desktop/cloud-adapter-lifecycle.test.mjs |

- 修复前（stash 回退两 src）：desktop 77 项 / 13 失败（A:7 B:2 C:4）。
- 修复后：desktop 84/84；全量 113/113。

### R2（静态协议 — STATIC_CONFIRMED）
- 新增：`06-desktop/contracts/inference-request.md`、`local-turn-lifecycle.md`、`cancel-recovery.md`。
- 证据片段：`06-desktop/evidence/snippets-r2/`。
- 已确认：providerRequest 删除 lifecycle_owner；payload 必填字段与 admission；scopeKey/leaseKey/duplicate/retired；turn.stop {requestId,expectedTurnId}; stopAndDrain 5000/100ms；409001/409005 恢复码与 canRecover/waitForInferenceRetry(750ms)；accepted 正常先于终态。
- 仍 UNKNOWN：messages/tools 元素结构、local-turn 请求体构造来源、服务端 turn.stop 语义/计费、409 完整形状。

### R3（离线集成闭环 — MOCK_VERIFIED）
- 新增 `src/desktop/recovery.mjs`；`tests/desktop/inference-flow.test.mjs`（7 场景）：新建→推理→终态→本地轮次同步；追问；工具片段合并+合成结果；取消；超时/错误/缺结束；冲突恢复判定；多回合隔离。

### R4（最小真实网关）
- LIVE_VERIFIED：`GET /local-agent/models`（protocol_version=2.0，9 模型）；`POST /chat/new`（scenario:2）。
- NOT_RUN：推理首轮/追问/本地轮次同步/在线取消 —— 因 messages/tools 元素结构与 local-turn 请求体构造 **UNKNOWN**，不在未确认前构造猜测载荷。
- 授权来源：`01-evidence/private/inkstone-auth.json`（uaa-token + ssouid）；未打印/未提交内容。

### 状态区分（不混淆）
- 历史：76294a8 基线 `npm test` 93/93、desktop 64/64（旧统计，保留）。
- 本轮：desktop 84/84、全量 113/113（工作区改动）。
- 未完成保留：Web A5/A6（NOT_RUN）、Windows 动态（BLOCKED/ENV_WINDOWS_REQUIRED）、原生 RPC（UNKNOWN）。

### 证据路径
`06-desktop/validation/round3-20261018T134450Z/results.json`

---

## 桌面 R2 续跑轮（2026-10-19T04:37:56Z，Linux）

- 起始 HEAD：`6d98bb7922970fed25108b85695b0c4939480ae0`（上轮 R1 已修复并推送）
- 审查基线（题干）：`76294a8…`；R1 三缺陷在 HEAD 已验证修复，未重复改写。

### 本轮新增（R2 扩展，STATIC_CONFIRMED）
- 应用↔运行时边界：JS 调 `turn.start`（`coreStartRequest`：query/model/mode/permissionMode/contextReferences…，**无 messages/tools**）；`messages/tools` 由原生运行时/gateway 侧生成 → JS 侧元素结构 **UNKNOWN**（有检索证据）。
- `gateway.inference.cancel`：载荷 `{requestId,streamId}`；`stream_not_found`/`stream_mismatch`；drain 超时 2500/30000；`semanticTerminal==='message_end'` → 写 `drainedInferences`（= recoveryProof）。
- local-turn 请求体构造来源：检索全部 180 应用文件未找到 → **UNKNOWN**（仅接收端校验）。

### 本轮新增实现/测试（MOCK_VERIFIED）
- `src/desktop/cancel.mjs`、`tests/desktop/cancel.test.mjs`（取消判定纯函数 + drain 常量）。

### 统计
- desktop 84 → **91/91**；全量 **120/120**。

### 保留未完成
- Web A5/A6（NOT_RUN）、Windows 动态（BLOCKED/ENV_WINDOWS_REQUIRED）、真实 gateway 推理（NOT_RUN/载荷 UNKNOWN）、原生 RPC（UNKNOWN）。
- 证据：`06-desktop/validation/round4-20261019T043756Z/results.json`。

---

## Linux→Windows 交接轮（2026-10-19）

- L1: cancel.mjs drainRecorded 去重；Windows ESM 模块URL；Python 跨平台发现。
- L2: 原生定向分析（agentd 命中方法名/类型 agentrpc.HarnessEventV1/工具 tag），线索级；Windows 采集任务 T1–T7。
- L3: driver-process.mjs / windows-driver-smoke.mjs / mock-headless-driver.mjs + 测试；07-handoff 文档。
- 统计: npm test 140/140；runner --help OK；MOCK discovery/chat/cancel 通过。
- 未完成: 桌面真实推理 NOT_RUN、Windows 动态 NOT_RUN、Web A5/A6 NOT_RUN、原生 RPC/取消/计费 UNKNOWN。
