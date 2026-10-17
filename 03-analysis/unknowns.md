# 未知项清单（P2/P3 汇总）

- 更新日期：2026-10-17
- 规则：只列**需要取证**的问题，不写成无证据结论。

| 编号 | 未知项 | 已有证据 | 缺少的证据 | 取证动作 |
| --- | --- | --- | --- | --- |
| U1 | 鉴权凭证类别与位置（Header/Cookie/Query） | 未登录 401（R002/R003）；源码有 `/api/v1/users/auth`、`/api/v1/login/byIam` | 登录后首个业务请求的请求头/凭证 | A1（需登录） |
| U2 | 聊天「发送」的实际请求（URL/方法/Body/Content-Type） | 源码见 `chat/new`、发送体字段（C-SEND） | 真实发送请求记录 | A1 |
| U3 | 聊天页流式发送代码所在 chunk | 已加载 24 脚本中无 `EventSource`/`text/event-stream`；发送代码疑似按需 chunk | 登录后按需加载的 chunk 或运行时网络记录 | A1 抓网络 + 下载新 chunk |
| U4 | 响应传输类型（JSON/SSE/NDJSON/WS）与事件类型 | 无 | 真实响应流样本 | A1/A2 |
| U5 | 会话/消息关联字段的真实返回名（`id`/`conversation_id`/`parent_id`） | 源码有 `parent_id` 链、`chat_id` | 真实响应字段 | A1/A2 |
| U6 | `aurora.openxlab.org.cn/v1/web/*` 与主站业务关系 | R004/R005（200） | 该域请求的用途与是否携带鉴权 | A1 对照 |
| U7 | 停止生成（A5）语义 | 源码有 `onStop`/`abort` | 真实取消行为与请求 | A5（若支持） |
| U8 | `chat/list` 的方法（源码写作既有 `get` 亦有 `post` 上下文） | 源码 | 真实请求方法 | A1/A4 |
| U9 | 统一响应约定（`code`/`success` 语义） | 源码三种判断并存 | 多接口真实响应 | A1/A2 |

## 取证优先级（最小动作）

1. U1 + U2 + U4：A1 一次发送即可同时覆盖（鉴权头、发送请求、响应流）。
2. U3：A1 期间开启网络记录并按需下载新 chunk。
3. U5/U9：A1+A2 对比。
4. U6/U7/U8：按需。
