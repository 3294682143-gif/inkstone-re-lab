# 推理请求契约（桌面 0.2.7）

- 证据文件：`out/main/index-CYl10ENn.js`（下称 **M**），SHA256 `f4b8148db01e9a196c28dd68d94761d715b834ee2fec3af861fe8ddec665acab`
- 证据等级：STATIC_CONFIRMED（源码明确） / INFERRED / UNKNOWN
- 本地片段：`06-desktop/evidence/snippets-r2/A-*.txt`

## 1. 产生路径

- RPC：`gateway.inference.start`（M:36820）→ 处理器 `startInference(payload, signal)`（M:37103）。
- 发送：`POST /local-agent/messages`，`Accept: text/event-stream`，`credentials:"omit"`（M:37727）。
- **发出前的转换**：`providerRequest = { ...payload }`；`delete providerRequest["lifecycle_owner"]`；`JSON.stringify`（M:37138-37142）。STATIC_CONFIRMED
  → `lifecycle_owner` 是**只在本地使用的内部字段**，不随请求发出。

## 2. 请求字段（`payload`）

| 字段 | 必填 | 约束（源码） | 证据 |
| --- | --- | --- | --- |
| `protocol_version` | 是 | 必须 `"2.0"` | M:38982 |
| `inference_kind` | 是 | `"turn"` \| `"detached"` | M:38978 |
| `lifecycle_owner` | 是 | `"turn"` \| `"independent"`；`turn` 必须 owner=turn 且**不得**带 `inference_id`/`parent_turn_id`/`trace_context`；`detached` 不得带 `turn_id` | M:38980 |
| `chat_id` | 是 | 正整数 | M:38986 |
| `turn_id` | turn 时必填 | 标识符字符串（`^[A-Za-z0-9_-]{1,160}$`，M:31182） | M:38987 |
| `inference_id` | detached 时必填 | 标识符字符串 | M:38987 |
| `parent_turn_id` | 否 | 标识符；缺省=自身 | M:38988 |
| `trace_context` | 否 | 对象：`schema_version`+`agent_id`+`run_kind`(枚举)；另允许 `parent_agent_id`/`parent_call_id`/`purpose`/`round`/`name`/`role`/`domain` | M:38989, M:39009 |
| `request_id` | 是 | 标识符 | M:37108 |
| `model` | 是 | 字符串 ≤120 | M:37146 |
| `messages` | 是 | 数组 | M:37147 |
| `tools` | 是 | 数组 | M:37148 |

> `messages`/`tools` 的**元素结构**在本 bundle 的该路径上未逐字段展开 → **UNKNOWN**（见 §5）。

## 3. 准入门禁（admission）

- `model` 必须**恰好匹配一个**能力：`capability.id === model`，或（当 `capability.id.toLowerCase() !== "auto"` 时）`canonical_id === model`；匹配数 ≠1 → 拒绝（M:37149-37180）。
- `messages`/`tools` 非数组 → `invalid_request`（not_dispatched / incompatible）（M:37150）。
- 限额：`messages.length ≤ limits.max_messages`、`tools.length ≤ limits.max_tools`、`request_bytes ≤ limits.max_request_bytes`；超出 → `InferenceRequestLimitError`（M:37160-37186）。

## 4. 身份与并发

- `scopeKey = chatId \0 kind \0 identity`；`leaseKey = chatId \0 parent`（M:38990）。
- 重复拒绝：`requestId` 处于 active/retired，或同一 `scopeKey` 已在 active → `duplicate_request`（M:37133-37137）。
- `streamId = "stream_" + uuid`（M:37190）；retired 上限 256（M:37220）。

## 5. UNKNOWN / 待真实网关验证

- `messages` 的 role 与 content 形状（文本/工具调用/工具结果如何表达与关联）——本路径未展开 → UNKNOWN；**不套用** OpenAI/Anthropic 结构。
- `tools` 元素结构（本仓库另有 `scpToolBindingSchema`，属 SCP 通道，不等同 gateway）。
- 服务端对 `messages`/`tools` 的语义与约束边界。
- 以上需真实网关往返（LIVE）确认。

## 6. 证据等级
- 字段与门禁、转换、身份：**STATIC_CONFIRMED**。
- 运行时发送/接受行为：**UNKNOWN**（无 LIVE）。

---

## 7. 应用 JS 与运行时的边界（本轮新增证据，STATIC_CONFIRMED）

- 应用（Electron 主进程）调用的是**运行时方法 `turn.start`**，而不是直接构造 gateway 推理体：
  `coreStartRequest = { requestId, chatId, projectId, projectContainer{version:"orbit-project-container-context/v1",kind:"managed",name,description}, query, model, reviewerModel, automaticReviewerEnabled, learnedSkillsEnabled, artifactProvenanceEnabled, mode:"deep"|"instant", permissionMode:"request_approval"|"risk_based", enabledSubagentIds, executionIntent:"execute", languageContract{version:"orbit-language-contract/v1",interactionLocale,targetLanguage,targetLanguageSource}, files:[], builtInSkillNames[], externalSkills[], contextReferences[], [projectMcpCatalogReference|scientificScpCatalogReference|projectMcpRoute|scientificRoute], [cause/backgroundNotifications], [remoteHostId/remoteHost/knownRemoteHosts] }`（M:56606-56700）。
- 调用：`callCoreTurnStartWithProvenanceCompatibility(coreStartRequest, payload => supervisor.callRuntime("turn.start", payload, 60000))`；返回要求 `{started:true, turnId}`，且 turnId 必须稳定（M:56714-56722）。
- 结论：**`messages`/`tools` 不在应用 JS 侧构造**——JS 只传 `query` + 上下文/模型/模式；`messages/tools` 由**原生运行时 → cloud gateway** 生成。已检索全部 180 个应用文件：`messages/tools` 的元素结构在应用 JS 中**无**构造来源。
- 因此 `messages/tools` 的元素 schema 仍为 **UNKNOWN**（归属：原生运行时/gateway 侧），JS 侧仅做“数组”与限额校验。


## 补充 R7：agentd 二进制字段清单（2026-10-20）

- 证据：`01-evidence/sanitized/desktop-agentd-strings-20261020.json`
- 方法：对 `orbit-agentd.exe`（SHA256 `bb56db4a…`，与 runtime manifest 一致）做 ASCII 串提取与 `json:"..."` 偏移聚类
- 引擎状态：IG5（缺 bundled Ghidra runtime）、ghidra-bridge（未装 Ghidra/pyghidra）均不可用，因此**未做反汇编**
- 结论分级：**字段名可证**；**请求体组合不可证**

已确认存在的 wire 候选字段（节选）：`answer_transport`、`input_delta`、`checkpoint_seq`、`tool_call_id`、`protocol_version`、`thinking_enabled`、`execution_mode`、`user_prompt`、`turn_id`、`chat_id`、`model`、`userMessage`、`submissions`、`max_output_tokens`、`token_usage`、`json_schema`、`tools`、`tool_choice`、`workspace_path`、`schema_version`、`client_version`、`binary_version`。

RPC 层类型名（字符串可见）：`agentrpc.ConversationCheckpointRequest`、`agentrpc.GatewayInferenceCancelRequest`、`agentrpc.GatewayDocumentRequest`。
