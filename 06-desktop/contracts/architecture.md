# 桌面端架构（0.2.7）静态地图

- 样本：`inkstone-desktop-0.2.7-setup.exe`（SHA256 `eb8ef2da…`）
- 应用：Electron；`resources/app.asar`（SHA256 `10c286f3…`）
- 确认等级：STATIC_CONFIRMED（结构/入口/IPC/端点）；运行行为 UNKNOWN

## 1. 分层

```
Electron 主进程 (out/main/index.js)
  ├─ Headless 入口（--headless-chat / --headless-chat-driver；index.js:161）
  ├─ ChatFeature / CoreChatRuntime（M:66252 / M:54696）
  ├─ Cloud Gateway 客户端（/local-agent/*）
  ├─ 本地原生监督器 startWindowsNativeSupervisor（M:40350）→ orbit-executor → agentd/brokerd
  └─ SafeAuth / SQLite 状态
preload (out/preload/index.cjs) → window.desktopTransport（@aderra/tipc:inkstone-desktop）
renderer（模块联邦远程件，本仓库 Web 侧另有采集）
```

## 2. 主入口与平台

- 主入口 `out/main/index.js`；`headless` 判定 `INKSTONE_HEADLESS_CHAT/…_DRIVER` 或 `--headless-chat[-driver]`（index.js:161）。
- 入口含 `admitHostPlatform`（index.js:141）：**当前包只允许 Windows/macOS**。
  → Linux 上不伪造平台验证；本轮只做静态与离线实现。

## 3. 网络边界

- Core API：`https://discovery.intern-ai.org.cn/api/orbit/v1`（M:4842）。
- 见 `contracts/cloud-gateway.md`（端点、请求体、身份头、SSE `type` 事件、轮次持久化）。
- 更新：`resources/app-update.yml`（generic；`https://static.openxlab.org.cn/releases/inkstone/`，channel latest）；renderer 热更新关闭。

## 4. IPC 边界

- 见 `contracts/ipc.md`（TIPC namespace `inkstone-desktop`，invoke `{route,input}`，ChatFeature 路由）。

## 5. 认证与状态

- 见 `contracts/auth-state.md`。

## 6. 本地运行时

- 见 `contracts/native-runtime.md`（Go，windows/x64，agentd/brokerd/executor）。

## 7. 三条支路区分（避免混淆）

| 支路 | 端点 | 事件字段 | 结束 |
| --- | --- | --- | --- |
| **桌面聊天主链** | `/chat/new`(scenario:2) → `/local-agent/messages` | `type` | `message_end`（前有 `usage`） |
| Web 聊天（既有基线） | `/chat/new`(scenario:1) → `/chat` | `event` | `workflow_finished` |
| 图像分析支路（包内仍存在） | `/chat` | `event` | `workflow_finished` |

## 8. UNKNOWN / BLOCKED

- Windows 实机：启动、登录、真实 IPC、safeStorage、原生工具生命周期 → **BLOCKED / ENV_WINDOWS_REQUIRED**。
- 原生 RPC 帧、取消/恢复/执行边界：UNKNOWN（P10 后续）。
