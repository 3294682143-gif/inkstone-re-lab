# 请求索引（P1 初步 / A0 未登录初始化）

- 采集方式：headless Chromium（patchright, chromium-1248）经代理 127.0.0.1:9999
- 采集脚本：`src/a0_capture.mjs`
- 原始记录：`01-evidence/sanitized/a0-network.json`（56 条 request/response 事件）
- 页面快照：`01-evidence/sanitized/a0-page.html`
- 浏览器会话：未登录（无凭证）；未注入 Hook
- 确认等级：**已观察**（仅 A0 初始化；业务请求尚未观察）

## 关键请求

| 请求编号 | 操作 | 方法 | 脱敏 URL | 类型 | 状态 | Content-Type | 业务角色（初步） |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R001 | A0 | GET | https://discovery.intern-ai.org.cn/chat/ | document | 200 | text/html | 聊天页外壳 |
| R002 | A0 | GET | https://discovery.intern-ai.org.cn/api/orbit/v1/models | xhr | **401** | text/plain | 模型清单（需鉴权） |
| R003 | A0 | GET | https://discovery.intern-ai.org.cn/api/spacebe/v1/space/list?page=1&page_size=100 | xhr | **401** | text/plain | 空间/会话列表（需鉴权） |
| R004 | A0 | POST | https://aurora.openxlab.org.cn/v1/web/start | fetch | 200 | application/json | 会话/前端初始化 |
| R005 | A0 | GET | https://aurora.openxlab.org.cn/v1/web/tags | fetch | 200 | application/json | 标签/配置 |
| R006 | A0 | GET | https://static.openxlab.org.cn/platform-config-upload/discoverypublic-mainchat-homequickstart.production.json | fetch | 200 | application/json | 首页快捷配置 |
| R007 | A0 | POST | https://sensorsdata.intern-ai.org.cn/sa.gif | ping | 200 | (gif) | 遥测（非业务，应排除） |

## 统计

- 资源类型分布：document 1 / script 25 / stylesheet 4 / fetch 5 / xhr 2 / ping 11 / image 6 / other 2
- 主机分布：discovery.intern-ai.org.cn 23、static.openxlab.org.cn 16、sensorsdata.intern-ai.org.cn 11、openxlab/aurora 各 2、at.alicdn.com 1

## 初步判断（待 P2 复核）

- 业务接口疑似位于 `/api/orbit/v1/*`（模型）与 `/api/spacebe/v1/*`（空间/会话）；未登录返回 401，说明**鉴权在服务端强制**。
- 存在跨域辅助域 `aurora.openxlab.org.cn`（`/v1/web/*`），是否为业务链路需登录后对照。
- 脚本为 webpack 产物（`main.*.js`、`vendors.*.js`）+ Module Federation 远程件（`remoteEntry.js`、`discovery-moce-fe`）。
- **未观察到任何聊天发送/流式响应**（未登录、未发消息）——A1 之后必须补采。

## 未知

- 鉴权凭证的类别与位置（Header/Cookie/Query）——需 A1。
- 聊天消息提交接口路径与传输类型（JSON/SSE/NDJSON/WS）——需 A1/A2。
- `aurora.openxlab.org.cn` 与主站接口的关系——需登录后对照。
