# 网页端 A5：停止生成（契约）

- 采集日期：2026-10-20
- 目标页：`https://discovery.intern-ai.org.cn/chat`
- 采集方式：Edge(CDP) 抓住真实网页操作产生的请求；凭证不入库
- 确认等级：**请求侧已观察**；**响应体与流终止语义未确认**

## UI 触发

| 项 | 值 |
| --- | --- |
| 发送键 | `button._sendBtn_*`（同一次生成内复用同一个按钮） |
| 空闲态 | `aria-label="开始探索"` |
| 生成中 | `aria-label="中止对话"` |
| 点击次数 | 一次点击即触发停止请求 |

## 请求

| 项 | 值 |
| --- | --- |
| 方法 | POST |
| 路径 | `/api/orbit/v1/chat/{chat_id}/stop` |
| Content-Type | `application/json` |
| 鉴权 | `Authorization: Bearer <jwt>`（jwt 来自可读 cookie `uaa-token`） |
| 请求体 | `{"message_id": <number>}` |

实测样本（`chat_id=1150742`）：`{"message_id":1402879}`、`{"message_id":1402890}`

## message_id 来源

来自对话流事件的 `mid`（`workflow_started` / `message` / `message_end` 均带 `cid`+`mid`）。停止必须携带当前这条消息的 mid，而不是 chat_id。

## 观测到的其它事实

- 同一停止动作在抓包里出现 **两次相同的 stop 请求**（原因未确认，见未知项）。
- stop 返回 `200`、`content-type: application/json`；**响应正文未取到**（CDP `Network.getResponseBody` 对流式请求未返回正文）。
- 页面上未出现文字形式的"已停止/已中断"标记（innerText 未匹配到）。

## 未确认（保留 UNKNOWN）

1. `stop` 响应 JSON 的字段结构（是否含终态原因、计费影响）。
2. 停止后 SSE 是否以 `message_end` / `workflow_finished` 收尾，或有专门的终止事件。
3. 两次重复 stop 是否为前端重试/幂等重发。
4. 远端计费是否随停止而止（本地无法证明）。

## 复现步骤

1. 打开目标页并登录，进入任一对话。
2. 发送一条会生成较长回答的消息。
3. 生成过程中点击发送键（此时 aria-label 为"中止对话"）。
4. 观察 `POST /api/orbit/v1/chat/{chat_id}/stop` 与请求体中的 `message_id`。
