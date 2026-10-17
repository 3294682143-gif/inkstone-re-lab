# 源码索引（P3 静态分析）

- 采集日期：2026-10-17
- 采集方式：从 A0 正常加载的脚本中下载（`src/fetch_sources.mjs`），保存于 `02-sources/original/`，哈希见 `manifest.json`
- 检索工具：ripgrep 14.1.1（`rev_*` 未使用——见 B7，deepspider/reverse 工具无法非交互驱动）
- 确认等级：**源码可证**（代码事实）；运行时行为**待 A1 验证**

## 脚本清单（关键项）

| 编号 | 文件（02-sources/original/） | 来源 URL | SHA256（前 16） | 作用 |
| --- | --- | --- | --- | --- |
| S-597 | discovery.intern_ai.org.cn_js_597.629ea519.chunk.js | https://discovery.intern-ai.org.cn/js/597.629ea519.chunk.js | 65352851c8d46175 | 历史列表 / HistoryProvider / orbit chat 基址 |
| S-MOCE | static.openxlab.org.cn_..._space-common-provider-5p1CqXmB.js | https://static.openxlab.org.cn/discovery-fe/prod/discovery-moce-fe/3b8d2b32/assets/space-common-provider-5p1CqXmB.js | 4c37b42e7e742f8c | **端点常量表 + 聊天发送/新建会话逻辑** |
| S-MAIN | discovery.intern_ai.org.cn_js_main.63f27b75.js | https://discovery.intern-ai.org.cn/js/main.63f27b75.js | 276709e379046dcc | 应用入口 |
| S-VEND | discovery.intern_ai.org.cn_js_vendors.1cb37f21.js | https://discovery.intern-ai.org.cn/js/vendors.1cb37f21.js | 见 manifest | 第三方库（axios 等） |
| S-REMOTE | discovery.intern_ai.org.cn_remoteEntry.js | https://discovery.intern-ai.org.cn/remoteEntry.js | 见 manifest | Module Federation 远程入口 |

> 完整 24 项见 `02-sources/original/manifest.json`（含 url/status/bytes/sha256）。

## 关键代码位置（S-MOCE）

| 编号 | 位置或片段 | 作用 | 关联请求 |
| --- | --- | --- | --- |
| C-ENDPOINTS | `EC="/api/v1",jC="/api/orbit/v1",$C="/api/spacebe/v1"...` | **REST 基址与端点常量表** | 多 |
| C-CHATNEW | `xO.post(IC,{data:{scenario:1,...e}})` → `data:{id}` | 新建会话：POST `/api/orbit/v1/chat/new` | 候选 R1xx |
| C-SEND | `const l={chat_id:s.id,query:n,prompt:n,thinkingMode:...,model:t.modelKey,spaceId:i,files:...,isNewChat:!0}` | 发送消息体字段（**未落到具体 URL，见未知项 U3**） | 候选 R1xx |
| C-NAV | `AO=(e,t)=>\`/repo/repository/${e}?chatid=${t}\``；`pending-new-chat:${e}`（sessionStorage） | 新建后跳转/暂存 | — |
| C-HIST | `r="/api/orbit/v1/chat", i=\`${r}/list\`, l={page:1,size:20,scenario:1}` | 历史列表 `POST?/GET /api/orbit/v1/chat/list` | 候选 |
| C-CHAIN | `for(i<3){ ... const i=await Ce(e,t); n.unshift(i); r=i.parent_id }` | 按 `parent_id` 回溯消息链（最多 3 层） | 候选 |
| C-TITLE | `jO = POST \`${jC}/chat/${e}/title\` {scenario:1,...}` | 设置会话标题 | — |
| C-DETAIL | `_O = GET \`${jC}/chat/${e}/detail\`` | 会话详情 | — |

## 已确认的端点常量表（源码字面量，S-MOCE）

| 常量 | 值 | 方法（调用点） |
| --- | --- | --- |
| EC | `/api/v1` | 前缀 |
| jC | `/api/orbit/v1` | 前缀 |
| $C | `/api/spacebe/v1` | 前缀 |
| _C | `${EC}/users/auth` | POST {code} |
| NC | `${EC}/users/getUserInfo` | POST {jwt} |
| TC | `${EC}/users/logout` | POST {jwt} |
| RC | `${jC}/models` | GET（A0 实测未登录 401，R002） |
| PC | `${jC}/chat` | 前缀 |
| IC | `${jC}/chat/new` | POST {scenario:1,space_id?} |
| AC | `${jC}/note/new` | POST |
| BC | `${jC}/upload-service/parse` | POST |
| MC | `${$C}/space/list` | GET（A0 实测未登录 401，R003） |
| LC | `${$C}/space/create` | POST |
| FC | `${$C}/space/assets/fetch-upload-url` | POST |
| DC | `${$C}/space/assets/check-upload` | POST |
| zC | `${$C}/space/assets/add` | POST |
| — | `${jC}/chat/${id}/title` | POST |
| — | `${jC}/chat/${id}/detail` | GET |
| — | `${jC}/chat/${id}/binding` | POST |

## 未使用/未发现

- 未见 `EventSource`、`text/event-stream`、`[DONE]`、`finish_reason` —— **不能据此断定非 SSE**：聊天页的流式发送代码可能位于尚未加载的按需 chunk（见 U3）。
