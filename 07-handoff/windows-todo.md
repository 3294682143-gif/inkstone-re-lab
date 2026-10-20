# Windows 动态采集任务（W4 用）

> 来源说明：本文件由 Windows 执行器生成。依据 `07-handoff/handoff.json` 的 `unknown_items` 与执行手册 §4.2/§4.3 的字段要求整理，**不包含任何 Linux 侧已确认的证据**。
> Linux 交接提交（e5d97bb）的 `handoff.json` 引用了本路径，但该文件中未随交付提供；缺失本身已记录为交付缺口。
> 状态列含义：`TODO` 未开始 / `BLOCKED` 有前置 / `PARTIAL` 部分采到 / `CONFIRMED` 有可回查证据。

| # | 未知问题（精确到字段/顺序） | 已知入口 | Windows 触发动作 | 观察位置 | 需要保留的字段 | 成功判据 | 未能证明的内容 | 状态 |
|---|---|---|---|---|---|---|---|---|
| 1 | `messages[]` 的元素结构：`role` 取值集合、`content` 是字符串还是内容块数组、内容块的 `type` 与纯文本字段名 | `turn.start` / `gateway.inference.start` 的请求构造；canonical → gateway 转换处 | discovery 之后的首次 chat 首轮 | JSONL 公开结果、官方日志、可观察的 RPC 边界 | `role`、`content[].type`、文本字段名、块顺序 | 抓到与本次合成 `request_id` 对应的真实请求体，字段名与类型可复述 | 服务端是否对缺失字段做默认填充 | TODO |
| 2 | `tools[]` 的名称、描述、`parameters` schema 结构 | 同上 | 需要工具可用的一次 chat（或工具授权事件） | 同上 + 工具授权事件 | `name`、`description`、`parameters.type/properties/required` | 至少一个真实工具的完整 schema 字段可复述 | 未触发的工具其 schema | BLOCKED（需先完成 W2） |
| 3 | 工具调用与工具结果的关联字段（call id / result 关联） | `messages[]` 中工具块；gateway 事件 | 触发一次真实工具调用并等待结果 | 同上 | 调用 id 字段名、结果块引用字段、顺序 | 能指出两端的同一 id | 并发多工具调用的排序 | BLOCKED |
| 4 | canonical 数据到 gateway wire 数据的转换规则 | adapter 与 gateway 之间的转换函数 | 首轮 + 追问各一次 | JS 侧转换点 + 实际 wire body | 字段改名、默认值、丢弃字段 | 同一 canonical 输入产生可预期的 wire 字段 | 服务端二次改写 | TODO |
| 5 | `conversation.start` / `checkpoint` / `complete` 的 body 与真实调用顺序 | `conversation.*` 构造与发送函数 | 首轮（start）、追问（checkpoint）、收尾（complete） | 请求边界 + 事件顺序 | 三个 body 的字段、`checkpoint_seq`、调用先后 | 顺序与字段均可复述，且与一次会话对应 | 异常中断时的重发语义 | TODO |
| 6 | `request_id` / `turn_id` / `message_id` / `checkpoint_seq` 的生成与传递 | 构造点与响应回填处 | 首轮 + 追问 + 停止 | 请求体与响应体 | 生成规则、是否客户端生成、跨轮是否递增 | 能指出每个 id 的来源与传递链 | 服务端重启后的 id 稳定性 | TODO |
| 7 | 本地 `turn.stop` 到后续取消/同步的具体路径 | 本地运行时 stop 入口 | 首轮进行中点停止 | 停止响应、终态通知、history | `stop` 的返回结构、终态事件、history 状态字段 | 三者收敛且能说明谁触发谁 | 远端计费是否随之停止 | BLOCKED（需先完成 W3） |

## 采集纪律

- 只使用已确认的 schema 发起请求；`session.create` 显式 `cleanup:false`。
- JSONL driver 的公开结果不等于 gateway 请求体，两者不得互相替代。
- 需要本地观测时，只在可回滚的分析副本上加局部观测，且只针对本次合成 `request_id`。
- 认证头、Cookie、凭据库、其他会话内容一律不进提交证据。
- 不为「跑通」而关闭认证、证书校验或平台保护。
- 每条动态结论必须绑定：应用样本哈希（`10c286f3…`）、交付 SHA、采集时间、触发动作。
- `accepted`、本地流关闭、mock 输出都不能当作完成证据。

---

## W1–W4 实机进展（2026-10-20）

| 任务 | 状态 | 证据 |
| --- | --- | --- |
| W1 driver 发现（driver.ready / projects / models） | **CONFIRMED** | 06-desktop/validation/windows-w1-20261020/results.json |
| W2 首轮 + 追问 + history | **CONFIRMED** | 06-desktop/validation/windows-w2-w3-20261020/results.json |
| W3 取消收敛（stop → 终态 stopped → history 收敛） | **CONFIRMED**（本地链路；远端计费 UNKNOWN） | 同上 |
| W4 messages 元素结构 | **CONFIRMED** | 01-evidence/sanitized/wire-canonical-20261020.json（text/thinking/tool_use/tool_result） |
| W4 tools 元素结构 | **CONFIRMED** | 同上（name/input/executionId/reconciliationVersion） |
| W4 local-turn start body | **CONFIRMED** | 同上（turn_id/protocol_version/execution_mode/model/thinking_enabled/user_prompt） |
| W4 checkpoint / complete body | **TODO** | 仅观测到 running_turn/cleared 本地状态 |
| W4 审批结构 | **TODO** | 需 permission_mode=request 且工具需审批；approval.list 需要 turn_id |
| W4 agentd → gateway 真实 wire body | **TODO** | 本地 canonical 与 wire 之间还有一层，未取得 |
| 关键前置（环境） | **CONFIRMED** | Electron 应用启动必须剔除 ELECTRON_RUN_AS_NODE |
| 关键前置（项目） | **CONFIRMED** | headless 无 projects.create；需先用 GUI 建本地项目 |
