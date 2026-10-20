# 接口契约（P2）

- 更新日期：2026-10-17
- 依据：A1/A2 实测（登录态，会话 1018682）+ A0 观察 + P3 源码
- 确认等级：**已观察**（除标注外）
- 凭证说明：登录态经 storageState 注入；**本文不记录任何可用凭证/Token/值**

---

## 接口 1：创建会话

- 证据请求编号：A1 的 `POST /api/orbit/v1/chat/new`
- 对应操作：首页输入后提交（新会话）
- 确认等级：已观察
- 方法：POST
- 域名和路径：`https://discovery.intern-ai.org.cn/api/orbit/v1/chat/new`
- Content-Type：请求 `application/json`；响应 `application/json; charset=utf-8`
- 鉴权类别与位置：由登录态（Cookie/SSO）承载；**具体位置未逐字段确认**（见 unknowns U1）
- 业务成功条件：响应 `code=0` 且 `data.id` 存在（源码判定 `0!==a||!s?.id`）
- 相关源码位置：S-MOCE `IC=${jC}/chat/new`；`xO.post(IC,{data:{scenario:1,...e}})`

### 请求字段

| 字段 | 类型 | 来源 | 说明 |
| --- | --- | --- | --- |
| `scenario` | number | 字面量 1 | 场景 |
| `space_id` | string? | 可选 | 归属空间（首页直达时可能省略） |

### 响应字段

| 字段 | 类型 | 含义 | 证据 |
| --- | --- | --- | --- |
| `code` | number | 0=成功 | 实测 |
| `data.id` | number | 新会话 chat_id（实测 1018682 / 1018638） | 实测 |

---

## 接口 2：发送消息（流式）

- 证据请求编号：A1 与 A2 各一次 `POST /api/orbit/v1/chat`
- 对应操作：发送 A1 / 追问 A2
- 确认等级：已观察
- 方法：POST
- 域名和路径：`https://discovery.intern-ai.org.cn/api/orbit/v1/chat`
- 请求 Content-Type：`application/json`
- **响应 Content-Type：`text/event-stream`（SSE）**
- 鉴权类别与位置：登录态（同上）
- 业务成功条件：SSE 正常结束于 `workflow_finished`
- 相关源码位置：`PC=${jC}/chat`

### 请求字段（实测 postData 的键）

| 字段 | 类型 | 来源 | 是否变化 | 作用 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `scenario` | number | 字面量 | 否 | 场景 | 实测 |
| `thinking_mode` | bool/number | 思考模式开关 | 随选项 | 开启思考 | 实测 |
| `planning_mode` | bool/number | 规划模式 | 随选项 | 规划 | 实测 |
| `model` | string | 选中模型 key | 随选项 | 模型 | 实测 |
| `query` | string | 用户输入 | 是 | 正文 | 实测 |
| `chat_id` | number | 会话 id | A2 复用 A1 的会话 | 会话关联 | 实测（A1/A2 同 chat_id=1018682） |

> 说明：实测 `query` 已含用户文本；源码里另有 `chat_id/query/prompt/...` 组合（`prompt` 未在本请求体出现，属跳转态暂存字段）。

### 响应字段或事件（SSE）

见 `04-contracts/event-protocol.md`。

### 待验证问题

- 鉴权凭证位置（Header/Cookie）—— U1
- 模型/思考/规划的取值域 —— U9（A6）

---

## 接口 3：会话标题

- 证据请求编号：A1/A2 后 `POST /api/orbit/v1/chat/{id}/title`
- 方法：POST，`{scenario:1,...}`；响应 JSON
- 作用：自动生成/设置会话标题

## 接口 4：会话工作区文件

- 证据请求编号：`GET /api/orbit/v1/workspace/{id}/files`
- 作用：会话相关文件列表（第一轮不涉及）

## 接口 5/6：模型清单 / 空间列表（A0 已观察）

- `GET /api/orbit/v1/models` → 未登录 401 / 登录 200，JSON
- `GET /api/spacebe/v1/space/list?page=1&page_size=100` → 未登录 401 / 登录 200，JSON

## 统一响应约定

- 业务 JSON：`{code:0, data:...}`（`success===true`/`code===200` 亦见于部分接口；需按接口区分，U9）。

## 失败/取消行为

- 未登录：401 + `text/plain`（A0 实测）。
- 取消（A5）：源码有 `onStop`/`abort`；真实语义未验证（U7）。


---

## 补充：2026-10-20 网页端实测新增端点（A5/A6 采集）

采集方式：Edge(CDP `Network`) 抓 `/chat` 页真实请求；凭证不入库（仅记录"存在 Authorization: Bearer"这一事实）。

| 方法 | 路径 | 状态 | 作用 | 证据 |
| --- | --- | --- | --- | --- |
| POST | `/api/user-center/v1/users/getUserInfo` | 200 | 用户信息（请求体含 `jwt` 字段，**不得入库**） | 抓包 |
| GET | `/api/user-center/v1/team/my_team_list` | 200 | 团队列表 | 抓包 |
| GET | `/api/user-center/v1/messages/unreadlist` | 200 | 未读消息 | 抓包 |
| GET | `/api/tokenplan/v1/users/free-grant-status` | 200 | 免费额度状态 | 抓包 |
| GET | `/api/orbit/v1/chat/list?page=1&size=20&scenario=1` | 200 | **历史列表（GET，非 POST）** | 抓包 |
| GET | `/api/orbit/v1/models` | 200（带 Bearer）；裸请求 401/code=-10002 | 模型列表，见 A6 契约 | 抓包 + 页面 fetch |
| GET | `/api/spacebe/v1/space/list?page=1&page_size=100` | 200 | 空间列表 | 抓包 |
| POST | `/api/orbit/v1/chat/{chat_id}/stop` | 200 | 停止生成，见 A5 契约 | web-a5a6-capture |
| POST | `/api/orbit/v1/chat/{chat_id}/title` | 200 | 发送后自动设置标题 | 抓包 |

**修正**：早前把 `/chat/list` 记作"POST 候选"，实测为 **GET**。

**发送请求体字段补全（实测）**：`scenario`、`thinking_mode`、`planning_mode`、`model`、`query`、`chat_id`。


---

## 补充 R2：源码静态提取的端点面（2026-10-20）

- 证据：`03-analysis/web-endpoints-r2.md`、`03-analysis/web-bundle-scan.json`（每条含 `文件@字节偏移`）
- 确认等级：**源码可证**（字面量存在），非运行时观察；不得据此宣称接口行为。

| 分组 | 新增端点 | 用途 |
| --- | --- | --- |
| spacebe | `GET /api/spacebe/v1/space/details`、`/space/assets/files`、`/space/assets/files/search` | 课题空间详情与文件检索 |
| user-center | `/users/auth`、`/users/profile`、`/users/feedback`、`/users/feedback/upload_url`、`/messages/{noticelist,announcementlist,read,readall_notice,announcement-mark-all-read}`、`/team/my_team_list` | 账号、消息、附件上传第一跳 |
| tokenplan | `/users/free-grant-status` | 额度状态（是否影响模型可见性：UNKNOWN） |
| scphub | `/scp/tags` | 科学工具标签 |
| datasets | `/category/list`、`/dataset/browse/add` | 科学数据 |

### 契约修正：传输层命名不一致（重要）

| 层 | 字段形态 | 证据 |
| --- | --- | --- |
| 组件层（MOCE provider 入参） | camelCase：`modelKey` / `thinkingMode` / `followup` | 源码字面量（@699378 / @700426） |
| 运行时可观察 wire | snake_case：`model` / `thinking_mode` / `planning_mode` | A5/A6 实测抓包 |

结论：两者之间存在一层**未定位的转换**。写实现时必须以运行时抓到的 snake_case 为准；组件参数不可直接当 wire 字段用。

### 新增 UNKNOWN（已登记到 windows-todo 的网页侧待采）

1. `space/assets/files` 的分页参数与返回结构。
2. `messages/*` 的已读语义。
3. `feedback/upload_url` 的上传凭证流程（附件链路）。
4. camelCase → snake_case 转换函数位置。
5. `/chat/list` 分页与返回字段（仅确认 GET 形态）。


## 补充 R3：MOCE 聊天模块源码级证据（2026-10-20）

- 数据源：`MOCE assets/index-Cd5teKeb.js`（542 KB，本轮补齐下载）
- 证据：`01-evidence/sanitized/web-chat-module-source-20261020.json`

| 结论 | 源码位置 | 说明 |
| --- | --- | --- |
| 提交体构造**内联转换** | @509319 | `thinking_mode: e.thinkingMode`、`model: e.modelKey`、`planning_mode: !1` —— 不存在独立转换函数，此 UNKNOWN 关闭 |
| 追问同一套字段 | @510200 | 无 messages 数组，上下文由 chat_id 承载 |
| 停止 = POST + 本地 abort | @53066 | `POST {base}/{chatId}/stop {message_id}` 后 `ITEM_STOPPED`；与 A5 抓包一致 |
| 终态事件集合 | @514689 | 5 个：message_end / done / close / error / workflow_finished |
| chat 基址 | @34994 | `/api/orbit/v1/chat` |
| 历史 | @514523 | `/api/orbit/v1/chat/{chatId}`，pageSize 100，replace/append |
| 反馈（新增端点） | @480225 | `POST /api/orbit/v1/chat/feedback {chat_id,message_id,feedback}` |
| 工作区文件（新增） | @519906 | `GET /api/orbit/v1/workspace/{id}/files` |
| 默认请求体 | @523252 | 含 `space_id`；scenario 取值 UNKNOWN |
| 附件形状 | @509319 | `files[].{type,file_type,url,file_hash,name,size}`，url 与 file_hash 必填 |

剩余 UNKNOWN：scenario 数值、SSE 完整 type 集合、stop 响应体字段。
