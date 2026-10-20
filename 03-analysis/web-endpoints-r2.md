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
