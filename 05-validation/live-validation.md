# 实网验证（P5）

- 日期：2026-10-17
- 方式：`src/client.mjs`（脱离浏览器的最小客户端），凭证从本地 storageState 读取（不入代码/日志）
- 鉴权（实测）：`Authorization: Bearer <uaa-token>` + Cookie(`uaa-token`/`ssouid`/`acw_tc`)；`Origin`/`Referer` 指向站点

## 新会话验证（新输入 / 新会话 / 多轮）

| 步骤 | 命令（占位符已替换为真实值） | 结果 |
| --- | --- | --- |
| dry-run | `node src/client.mjs --dry-run --fixture fixtures/first-turn.json` | `finished:true, answer:"OK"` |
| 新会话 A | `--live --scenario new-conversation --text "INKSTONE-RE-LIVE-01：请只回复 OK。"` | chat/new→id **1018929**；send 200 text/event-stream；`answer="OK"`，finished |
| 追问 A | `--live --scenario follow-up --conversation-id 1018929 --text "请复述我上一条消息中的测试标记。"` | 200；`answer="您上一条消息中的测试标记是：**INKSTONE-RE-LIVE-01**"` |
| 新会话 B | `--live --scenario new-conversation --text "INKSTONE-RE-LIVE-01：请只回复 OK。"` | chat/new→id 1018929(见上)；另见回归 1018985/1018987/1018988 |

## 浏览器侧验证（A0–A4）

| 场景 | 结果 | 证据 |
| --- | --- | --- |
| A0 未登录 | 200 外壳；`/api/orbit/v1/models`、`spacebe/space/list` 401 | a0-network.json |
| 登录校验 | 401→**200**（models/space list/getUserInfo/chat list） | login-check.json |
| A1 | chat/new→1018682；`POST /api/orbit/v1/chat` 200 `text/event-stream`；answer="OK" | a1a2-raw.json |
| A2 | 同会话追问→复述 `INKSTONE-RE-A1` | a1a2-raw.json |
| A3 | 新会话 1018771，同文本；会话级字段随会话变 | a3a4-summary.json |
| A4 | 刷新→点历史→`GET /api/orbit/v1/chat/1018771/detail` 200 | a3a4-summary.json |

## 失败与纠正记录（如实）

| 现象 | 诊断 | 修复 |
| --- | --- | --- |
| `chat/new` → `code=-10002` | 缺 `Authorization: Bearer <uaa-token>` 头 | 客户端从 storageState 读取并附加 |
| 追问 → HTTP 400 | `chat_id` 传成字符串（浏览器发 number） | 构造器把纯数字字符串转 number |
| SSE 文本乱码 | `response.text()` 按 cp1252 解码 | 改为按字节 UTF-8 读取 |

## 限制

- 凭证更新：重新导出 storageState 覆盖同路径即可；客户端不写死值。
- 未实现/未验证：停止生成（A5）、模型切换（A6）、附件、错误流形态。
- 轮次间隔加了 1.5s，避免高频调用；未触发 429。

---

## 本轮修复轮·在线验收（2026-10-17）

> 历史记录（上文）保留不变。

- 命令：`node src/regress.mjs --n 3 --mark ACCEPT-20261017T140842Z --storage-state 01-evidence/private/inkstone-auth.json --out 05-validation/accept-20261017T140842Z/regression.json`
- 退出码：0；`allOk=true`；`executed=3`；`completedTurns=6`；`distinctSessionIds=true`。
- 会话 ID：1021107 / 1021113 / 1021117（真实创建、互异）。
- 每轮 `status=200` 且 `finished=true`；每组追问均包含各自首轮标记。
- 结果文件：`05-validation/accept-20261017T140842Z/regression.json`（脱敏，无凭证）。
- 登录态探测：`GET /api/orbit/v1/models` → 200（有效）。

- 所测代码版本：`2657ec4d845a2f619fc5ed9f23d09eb80e560545`

---

## 网页端 A5/A6 实测（2026-10-20，Windows + Edge CDP）

| 场景 | 方法 | 结果 | 证据 |
| --- | --- | --- | --- |
| A6 模型列表 | 页面上下文 fetch + Bearer | `200 / code=0 / data.models[8]`，条目仅 `name/tags/icon` | `01-evidence/sanitized/web-a5a6-capture.json` |
| A6 鉴权差异 | 裸 fetch vs 带 Bearer | 裸 `401/code=-10002`；带 Bearer `200` | 同上 |
| A6 思考模式切换 | 点 `快速` → `深度` | `discovery:science-thinking-mode-preference`: `true → false → true` | 同上 |
| A6 模型切换 | 点 `button[title="选择模型"]` | 选择器打开；偏好 `discovery:science-model-preference = 书生-S2`；**下拉项 DOM 未取到** | 同上 |
| A5 停止生成 | 发送后点 `aria-label=中止对话` | `POST /api/orbit/v1/chat/{chat_id}/stop` body `{"message_id":<n>}`，`200` | 同上 |
| A5 未取到 | stop 响应体 / SSE 终止事件 | **UNKNOWN**（CDP getResponseBody 对流式未返回正文） | — |

结论边界：本轮确认的是**请求侧协议与本地偏好语义**；响应结构、流终止与计费语义仍为 UNKNOWN，不宣称取消闭环完成。
