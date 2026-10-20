

## 补充 R5：工具调用 canonical 结构（W4，2026-10-20）

- 证据：`01-evidence/sanitized/wire-canonical-20261020.json`（`tool_calling` 段）
- 取得方式：headless `session.create(permission_mode="auto")` + `turn.send` 让模型真实调用本地工具

### tool_use 块

```json
{"type":"tool_use","id":"chatcmpl-tool-<id>","executionId":"exec_<sha256>","name":"Bash","input":{"command":"dir","cwd":"."},"reconciliationVersion":"broker-reconcile.v1"}
```

### tool_result 块

```json
{"type":"tool_result","executionId":"exec_<sha256>","toolUseId":"chatcmpl-tool-<id>","content":"<JSON string>","isError":false}
```

- `content` 是**字符串化的 JSON**；该块所在消息的 `role` 是 `user`。
- 两层命名：canonical `name` 为 `Bash`/`ListTree`；agent 事件的 `tool` 为 `run_command`/`list_tree`。

### agent 事件类型

| type | 关键字段 |
| --- | --- |
| workflow | event_id, seq, step, status(RUNNING/SUCCESS), agent_id, hint |
| tool_call | step, round, activity_id(call_*), tool, call_id, hint |
| tool_result | 同 tool_call + status(SUCCESS) |

`executionSummary`：`{toolCalls:2,toolFailures:0,approvalsRequested:0,filesChanged:[],commandsRun:1}`

### 审批

- `permission_mode` 合法值：`auto` / `request`（非法值会返回 HEADLESS_INVALID_PARAMS）。
- `approval.list` 需要 `turn_id` 参数。
- 本轮 `auto` 未触发审批，审批结构仍 UNKNOWN。
