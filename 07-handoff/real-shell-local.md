# 本地运行真站前端（像素级一致）

目标：界面与真站完全一致，但**不连真站 API**——所有 /api 由本地 mock 提供。

## 启动

```powershell
# 1) mock 后端
node tools/mock-gateway.mjs --port 8787 --host 127.0.0.1

# 2) 真站前端宿主（另一个窗口）
node tools/real-shell-host.mjs
```

然后浏览器打开 <http://127.0.0.1:8899/chat>。

## 它做了什么

| 能力 | 实现 |
| --- | --- |
| 真站 UI | 壳 JS/CSS/图片按原 URL 路径本地提供（`02-sources/original/` + `real-shell/`） |
| 聊天界面 | MOCE 远程模块（`/mock-cdn/moce/`）本地副本，不走 CDN |
| 后端 | 所有 `/api/*` 反向转发到本地 mock（8787） |
| 登录态 | 合成 `uaa-token`/`ssouid` cookie + `getUserInfo` 合成用户（不走 SSO） |
| 路由 | `/chat/chat/<id>` 与 `/chat/<id>` 归一化为 `/chat`，避免会话详情页崩溃 |

## 已验证

- 首页：Hero、快速/深度、Auto、推广横幅、页脚 ICP 全部为真站样式
- 登录：登录横幅消失，头像显示「本」，最近对话出现「合成会话（离线）」
- 对话：输入「本地 mock：请只回复 OK」→ 本地 mock 流式返回 `OK`，页面渲染正常

## 已知边界

- 未登录真站、未使用真站凭据；用户为合成用户
- 侧栏少数徽标接口（team/my_team_list、messages/unreadlist、free-grant-status）返回 404，仅为徽标缺失
- 会话详情页（打开历史会话）在本地 mock 数据形状下仍可能不完整
