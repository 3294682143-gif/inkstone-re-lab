# 原生运行时（Go PE）静态地图（0.2.7）

- 证据：`resources/runtime/manifest.json` + 三份 Windows x64 Go PE（未执行）
- 确认等级：STATIC_CONFIRMED（清单/哈希/构建信息/字符串）；运行行为 UNKNOWN

## 1. 清单（resources/runtime/manifest.json）

| role | file | size | sha256 |
| --- | --- | ---: | --- |
| agent_runtime | orbit-agentd.exe | 57364184 | bb56db4a67df1da0f810624872322de399b76f016e508ad7b63f514b03ab1409 |
| broker | orbit-brokerd.exe | 29981920 | 827a58d163eb5dfd69aeef32098f0578a614d7d19902d36efdc16e352678e377 |
| executor | orbit-executor.exe | 22546136 | 2414747197eb7190ef9b21d149ac3a2037d3dbba0c1cc272c2adc9f2cb00b624 |

- `client_runtime_backend: go`，`platform: windows`，`arch: x64`，`bundle_build_id: 0.2.7-8dabffa00633`，`binary_version: 0.2.7`，`revision: 8dabffa00633`。
- 三份实算哈希与清单**逐一一致**（本轮校验）。

## 2. 构建信息（agentd，字符串级）

- `go1.24.13`；`GOOS=windows`；`GOARCH=amd64`。
- 模块路径 `github.com/MigoXLab/intern-inkstone`。
- 出现大量 `agent.* / turn.*` 字符串（`agent.history`、`agent.validate`、`turn.start`、`turn.event`、`agent.recovery`、`agent.durable`、`agent.capability`、`agent.session`、`agent.tool`……）→ 与 Electron 侧 RPC 边界呼应，属**线索**，方法签名/语义未展开 → UNKNOWN。

## 3. 启动与监督（Electron 侧入口）

- `startWindowsNativeSupervisor(executable, cwd, …)`（`M:40350`）：以 **executor** 为监督入口启动 agent/broker（`M:41545` `bundle.binaries["orbit-executor"]`；`M:42559` 再次启动/恢复）。
- 含状态目录、租约、恢复握手（`M:41505` 起）→ **不能按裸 CLI 随意拼参数**。

## 4. 与本轮的关系

- 本轮（Linux）只做静态：读清单、哈希、构建信息、字符串。**不启动任何 PE**。
- RPC 方法帧、取消/恢复/执行路径的下钻：需要进一步静态（符号/反汇编）与 Windows 动态验证 → P10 后续 / P9。
- 状态：`agentd/brokerd/executor` 的**职责**已知（清单 role），**协议细节 UNKNOWN**。

---

## L2 定向分析（2026-10-19，Linux，STATIC/CLUE）

- 方法：对既有提取结果 `01-evidence/private/desktop-027/payload/resources/runtime/*.exe` 做字符串/JSON tag 检索（未运行 PE、未用 Wine/Xvfb）。**字符串命中只算线索，不作 wire schema 证明。**
- 二进制 SHA256：agentd `bb56db4a67df1da0f810624872322de399b76f016e508ad7b63f514b03ab1409`；brokerd `827a58d1…`；executor `24147471…`（同 manifest）。

### 命中（线索）
| 线索 | agentd 命中数 | 说明 |
| --- | --- | --- |
| `turn.start` | 56 | 本地运行时回合入口（与 JS `callRuntime("turn.start")` 对应） |
| `gateway.inference.start` / `.cancel` | 2 / 1 | 推理发起/取消方法名 |
| `conversation.start` / `.checkpoint` / `.complete` | 6 / 1 / 11 | 轮次同步方法名 |
| `lifecycle_owner` / `inference_kind` | 2 / 2 | 推理身份字段（JS 侧发送前删除 lifecycle_owner） |
| `checkpoint_seq` | 12 | 检查点序列 |
| `work_mode` / `permission_mode` | 2 / 1 | 模式字段 |
| `tool_use` / `tool_result` | 193 / 31 | 工具事件语义 |
| `partial_json` / `stop_reason` / `protocol_version` | 2 / 3 / 3 | 事件字段 |
| `message_start/thinking_delta/tool_use_start/tool_input_delta/tool_use_end/message_end` | 4/1/1/1/2/2 | gateway `type` 事件名 |

### JSON tag / 类型线索
- Go 类型：`agentrpc.HarnessEventV1`（`Messages json:"messages"`、`Metadata json:"metadata"`、`streamId json:"streamId"`）。
- 相关 tag：`messages`、`tools`、`role`、`content`、`name`、`description`、`input_schema`、`input`、`arguments`、`usage`、`input_tokens`、`output_tokens`、`model`、`permissionMode`、`project_id`、`request_id`、`turn_id`、`message_id`、`tool_use_id`、`checkpoint_seq`、`protocol_version`、`turnId`/`checkpointSeq`（camelCase，疑为内部结构而非 wire）。
- 键串样本：`… failed input_delta tool_choice tool_use_id response_id stop_reason after_model before_tool publication create_file upload_file run_command python_cell …`（内部字符串表）。
- → 指向：gateway `type` 事件键（`response_id`/`stop_reason`/`tool_use_id`/`partial_json`）与工具 schema（`name`/`description`/`input_schema`）在**原生侧**存在构造/消费代码。**元素级 wire schema 仍 UNKNOWN**，须动态采集确认。

### §4.2 问题的当前答复（线索级）
1. messages 角色/内容块/纯文本编码：UNKNOWN（有 role/content/messages tag 线索）。
2. tools 名称/描述/参数 schema：UNKNOWN（有 name/description/input_schema 线索）。
3. 工具调用↔结果关联字段：线索 `tool_use_id`（+ `response_id`）。
4. canonical → gateway wire 转换：UNKNOWN（`agentrpc.HarnessEventV1.Messages` 是线索）。
5. start/checkpoint/complete body 与顺序：方法名确认；**body 结构与真实顺序 UNKNOWN**。
6. request_id/turn_id/message_id/checkpoint_seq 生成与传递：JS 侧已知（`host.createId()`）；原生侧生成点 UNKNOWN。
7. 本地 turn.stop → 取消/同步路径：JS 侧 `turn.stop{requestId,expectedTurnId}`、`gateway.inference.cancel{requestId,streamId}`；原生内部路径 UNKNOWN。

### 交付的 Windows 采集任务
见 `07-handoff/windows-todo.md`（逐项字段/入口/动作/观察点/判据/未证内容）。
