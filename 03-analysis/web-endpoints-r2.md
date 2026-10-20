# 网页端端点清单 R2（源码静态提取）

- 采集日期：2026-10-20
- 方法：扫描已下载的前端包 `02-sources/original/*.js`（24 个文件，SHA256 见 `manifest.json`），提取字符串字面量形式的 `/api/...` 路径与协议 token
- 机器可读结果：`03-analysis/web-bundle-scan.json`（含每条命中的文件与偏移）
- 确认等级：**源码可证**（字面量存在）；**未运行时验证**（不据此宣称接口行为）

> 说明：本清单补充此前 `source-index.md` 的端点表（那张表来自 S-MOCE 的常量段）。本轮把范围扩到全部已下载 chunk，并把证据精确到 `文件@字节偏移`。

## 1. 端点（共 25 条）

| 路径 | 首条命中（文件@偏移） |
|---|---|
| `/api/datasets/v1/category/list` | `discovery.intern_ai.org.cn_js_597.629ea519.chunk.js@109955` |
| `/api/datasets/v1/dataset/browse/add` | `discovery.intern_ai.org.cn_js_597.629ea519.chunk.js@48128` |
| `/api/orbit/v1` | `static.openxlab.org.cn_discovery-fe_prod_discovery-moce-fe_3b8d2b32_assets_space-common-provider-5p1CqXmB.js@570720` |
| `/api/orbit/v1/chat` | `discovery.intern_ai.org.cn_js_597.629ea519.chunk.js@111074` |
| `/api/scphub/v1/scp/tags` | `static.openxlab.org.cn_discovery-fe_prod_discovery-moce-fe_3b8d2b32_assets_space-common-provider-5p1CqXmB.js@764068` |
| `/api/spacebe/v1` | `static.openxlab.org.cn_discovery-fe_prod_discovery-moce-fe_3b8d2b32_assets_space-common-provider-5p1CqXmB.js@570739` |
| `/api/spacebe/v1/space/assets/files` | `static.openxlab.org.cn_discovery-fe_prod_discovery-moce-fe_3b8d2b32_assets_space-common-provider-5p1CqXmB.js@806600` |
| `/api/spacebe/v1/space/assets/files/search` | `static.openxlab.org.cn_discovery-fe_prod_discovery-moce-fe_3b8d2b32_assets_space-common-provider-5p1CqXmB.js@815129` |
| `/api/spacebe/v1/space/details` | `static.openxlab.org.cn_discovery-fe_prod_discovery-moce-fe_3b8d2b32_assets_space-common-provider-5p1CqXmB.js@814819` |
| `/api/spacebe/v1/space/list` | `static.openxlab.org.cn_discovery-fe_prod_discovery-moce-fe_3b8d2b32_assets_space-common-provider-5p1CqXmB.js@812092` |
| `/api/tokenplan/v1/users/free-grant-status` | `discovery.intern_ai.org.cn_js_597.629ea519.chunk.js@61512` |
| `/api/user-center/v1/messages/announcement-mark-all-read` | `discovery.intern_ai.org.cn_js_597.629ea519.chunk.js@104007` |
| `/api/user-center/v1/messages/announcementlist` | `discovery.intern_ai.org.cn_js_597.629ea519.chunk.js@103557` |
| `/api/user-center/v1/messages/noticelist` | `discovery.intern_ai.org.cn_js_597.629ea519.chunk.js@103239` |
| `/api/user-center/v1/messages/read` | `discovery.intern_ai.org.cn_js_597.629ea519.chunk.js@104236` |
| `/api/user-center/v1/messages/readall_notice` | `discovery.intern_ai.org.cn_js_597.629ea519.chunk.js@104065` |
| `/api/user-center/v1/messages/unreadlist` | `discovery.intern_ai.org.cn_js_597.629ea519.chunk.js@16974` |
| `/api/user-center/v1/team/my_team_list` | `discovery.intern_ai.org.cn_js_597.629ea519.chunk.js@111773` |
| `/api/user-center/v1/users/auth` | `discovery.intern_ai.org.cn_js_597.629ea519.chunk.js@92916` |
| `/api/user-center/v1/users/feedback` | `discovery.intern_ai.org.cn_js_597.629ea519.chunk.js@45414` |
| `/api/user-center/v1/users/feedback/upload_url` | `discovery.intern_ai.org.cn_js_597.629ea519.chunk.js@46627` |
| `/api/user-center/v1/users/getUserInfo` | `discovery.intern_ai.org.cn_js_597.629ea519.chunk.js@92985` |
| `/api/user-center/v1/users/logout` | `discovery.intern_ai.org.cn_js_597.629ea519.chunk.js@93027` |
| `/api/user-center/v1/users/profile` | `discovery.intern_ai.org.cn_js_597.629ea519.chunk.js@44653` |
| `/api/v1` | `static.openxlab.org.cn_discovery-fe_prod_discovery-moce-fe_3b8d2b32_assets_space-common-provider-5p1CqXmB.js@570707` |

## 2. 已知分组

| 前缀 | 用途 | 备注 |
| --- | --- | --- |
| `/api/orbit/v1` | 对话域：chat / chat/new / chat/{id}/title / chat/{id}/detail / models / chat/list / chat/{id}/stop | chat / stop 已由运行时抓包确认（A5/A6 契约） |
| `/api/spacebe/v1` | 课题空间：space/list、space/details、space/assets/files、space/assets/files/search | 桌面/网页共用；本轮仅源码可证 |
| `/api/user-center/v1` | 账号中心：auth、getUserInfo、logout、profile、feedback(+upload_url)、messages/*、team/my_team_list | 登录与消息域 |
| `/api/tokenplan/v1` | 额度域：users/free-grant-status | 与 A6 的模型可用性可能相关（未验证） |
| `/api/scphub/v1` | 科学工具广场：scp/tags | |
| `/api/datasets/v1` | 科学数据：category/list、dataset/browse/add | |

## 3. composer（输入区）源码语义

来自 `MOCE/space-common-provider-5p1CqXmB.js`：

| 观察点 | 事实 | 偏移 |
| --- | --- | --- |
| 模型列表项形状 | 组件用 `_j(ne, o)` 从列表里按 key 找模型，取 `.name`；列表项至少有 `{key, name}` | @699378（`modelKey`） |
| 思考模式取值 | `o_={Auto:"Auto", auto:"Auto", [Q$]:"Thinking"}`，即 UI 层取值是 **Auto / Thinking** 这一级，不是布尔 | @699100 附近 |
| 停止按钮 | 组件入参含 `stopLabel`、`onStop`、`isGenerating`；生成中把提交按钮换成停止 | 同段 |
| followup | 有 `followup` 字段消费点（推荐追问渲染） | @700426 |
| 会话标题/详情 | `/title`、`/detail` 子路径 | @620321 / @620405 |

> 与运行时抓包的差异（重要）：抓包看到的发送体是 **snake_case**（`thinking_mode`/`planning_mode`/`model`），而组件层参数是 **camelCase**（`thinkingMode`/`modelKey`）。说明两者之间存在一层转换，**转换函数本轮未定位**（保持 UNKNOWN，不以组件参数反推 wire 字段）。

## 4. 本轮新增的待验证项（转 Windows/登录态采集）

1. `space/assets/files` 的参数与返回（课题空间文件列表分页）。
2. `messages/*` 系列的标记已读语义（`read`/`readall_notice`/`announcement-mark-all-read`）。
3. `user-center/v1/users/feedback/upload_url` 的上传凭证获取方式（附件链路的第一跳）。
4. camelCase → snake_case 的转换函数位置与规则。
5. 历史列表分页参数（`/chat/list` 的 page/size 与返回结构，目前仅 GET 形态确认）。


## 5. 未登录态探针（2026-10-20，运行时观察）

- 环境：面板浏览器（未登录 profile），在目标 origin 上以页面上下文 GET 各端点
- 证据：`01-evidence/sanitized/web-probe-unauth-20261020.json`

| 端点 | 结果 | 含义 |
| --- | --- | --- |
| `/api/orbit/v1/models` | 401 / -10002 | 存在，需鉴权 |
| `/api/orbit/v1/chat/list` | 401 / -10002 | 存在，需鉴权 |
| `/api/orbit/v1/chat/{id}/detail` | 401 / -10002 | 存在，需鉴权 |
| `/api/spacebe/v1/space/{list,details,assets/files}` | 401 / -10002 | 存在，需鉴权 |
| `/api/user-center/v1/users/getUserInfo` | **405** | **GET 不允许**（契约记载为 POST `{jwt}`） |
| `/api/user-center/v1/messages/unreadlist` | 401 / -10002 | 存在，需鉴权 |
| `/api/user-center/v1/team/my_team_list` | 401 / -10002 | 存在，需鉴权 |
| `/api/tokenplan/v1/users/free-grant-status` | 401 / -10002 | 存在，需鉴权 |
| `/api/scphub/v1/scp/tags` | **200 / code=0** | **公开**：`data.list[17]`，项含 `id/name/name_en/icon/type` |
| `/api/datasets/v1/category/list` | **200 / code=0** | **公开**：`data.list[6]` + `total`，项含 `id/name/icon_url/sort/background_color` |

> 判定规则：401 只说明"需要鉴权"，不能据此认为路径不存在；本次没有出现 404，说明清单里的路径全部真实存在。


## 6. 子应用（Module Federation 远程件）2026-10-20

壳工程只包含侧栏/聊天/账号，其余模块是**独立子应用**，通过 `/xxx-static/remoteEntry-var.js` 注册。实测存在的 9 个：

| 子应用 | remoteEntry |
| --- | --- |
| 论文工具 | `/paper-static/remoteEntry-var.js` |
| 课题空间 | `/repo-static/remoteEntry-var.js` |
| 科研应用 | `/app-static/remoteEntry-var.js` |
| 科学工具 | `/scp-static/remoteEntry-var.js` |
| 科学数据 | `/dataset-static/remoteEntry-var.js` |
| 科学计算 | `/compute-static/remoteEntry-var.js` |
| 科研模型 | `/token-plan-static/remoteEntry-var.js` |
| 聊天（MOCE） | `/chat-static/remoteEntry-var.js` + `static.openxlab.org.cn/.../moce-fe/<build>/remoteEntry.js` |
| 用户中心 | `/user-center-static/remoteEntry-var.js` |

> 结论：仓库此前抓到的是壳 + MOCE 聊天模块；这 7 个侧栏入口的实现分别在各子应用的包里，壳的 bundle 中不存在。

### 论文子应用（已采集）的接口面

来源：`02-sources/original/paper-static/`（12 个文件）

| 分组 | 端点 |
| --- | --- |
| 检索 | `POST /api/nova/v1/search/works`、`/works/term-segmentation`、`/search/authors` |
| 分面 | `/works/facets/{years,fields,types}` |
| 单篇 | `/works/{id}`、`/works/{id}/{references,cited-by,related,read,pdf_url_check}` |
| 收藏 | `/works/check_saved`、`/search/save-space` |
| 热点/历史 | `/search/hot-papers`、`/search/recent-searches`（+ `clear`、`clear/{id}`） |
| 对话 | `POST /api/nova/v1/chat` |

新增 API 前缀：`nova`（此前只有 datasets/orbit/scphub/spacebe/tokenplan/user-center）。


### 子应用接口面（2026-10-20，用仓库 fetch_sources 下载）

| 子应用 | 包位置 | API 前缀 | 端点（节选） |
| --- | --- | --- | --- |
| 论文工具 | `/paper-static/` | `nova` | `POST /api/nova/v1/search/works`、`/works/{id}/{references,cited-by,related,read,pdf_url_check}`、`/search/{hot-papers,recent-searches,authors,save-space}`、`POST /api/nova/v1/chat` |
| 科研应用 | `static.openxlab.org.cn/.../discovery-app-fe/<build>/` | `moce` | `/api/moce/v1/apps/list`、`/apps/view`、`/dry_wet_loop/apply`、`/dry_wet_loop/apply/status/list` |
| 科学计算 | `/compute-static/` | `ml` | `/api/ml/v1/dev-machine/{list,create,start,stop,delete,enter,rename}`、`/cloud-disk/{list,quota,mkdir,rename,move,copy,delete,download-url,upload-url}`、`/dataset/mount-list`、`/mirrors`、`/resource/*`、`/training/code_upload_url`、`/inference` |

### 仓库工具缺陷修复（本轮）

`src/fetch_sources.mjs` 在两处无法在本机运行：

1. 无代理时仍构造 `new ProxyAgent(PROXY)` → `Proxy uri is mandatory`；改为 `PROXY ? new ProxyAgent(PROXY) : undefined`。
2. `const doFetch = ufetch || fetch` 中 `ufetch` 未定义 → ReferenceError；改为 `const doFetch = fetch`。

修复后该脚本可对任意 `a0-network.json` 工作，本轮据此采集了 paper / compute / app 三个子应用。
