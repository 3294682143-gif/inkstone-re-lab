# 桌面 IPC 契约（0.2.7）

- 证据：`out/preload/index.cjs`（`4303ea1a…`）、`M = out/main/index-CYl10ENn.js`（`f4b8148d…`）
- 确认等级：STATIC_CONFIRMED

## 1. 传输

- preload 暴露 `desktopTransport`：`contextBridge.exposeInMainWorld("desktopTransport", …)`（preload:319），namespace `inkstone-desktop`（preload:302）。
- 通道：`@aderra/tipc:<namespace>:invoke`（`CHANNEL_PREFIX="@aderra/tipc"`，`channelsFor(ns)` 的 `invoke`，preload:67/69/72）。
- invoke 载荷：`{route, input}`（preload 校验 `hasOnlyKeys(value,["route","input"])`，preload:143/217-223）。另有 `{route,args}`、带 `id` 的流式形态（preload:146/151）。
- route 路径：点分 `assertRoutePath`，禁止空段/含点段/内部前缀/保留段（preload:26-29）。

## 2. ChatFeature 路由（M:66252 起）

| route | 校验 | 说明 |
| --- | --- | --- |
| `listModels` | — | 模型目录（→ `/local-agent/models`） |
| `startTurn` | `startSchema` | 发起一轮推理 |
| `stopTurn` | `stopSchema{requestId}` | 停止一轮 |
| `getHistory` | `historySchema{chatId}` | 历史 |
| `controlTurn` | `controlSchema` | 轮次控制 |
| `decide` / `resolveApproval` | `decisionSchema` | 审批决定 |

> route 名称与方法均为 STATIC_CONFIRMED；schema 字段细节部分 UNKNOWN（未展开 zod 定义）。

## 3. 数据流（静态）

```
renderer → desktopTransport.invoke(route,input) → @aderra/tipc:inkstone-desktop:invoke
        → 主进程 ChatFeature(路由+schema 校验) → CoreChatRuntime → Cloud Gateway(/local-agent/*)
        → 本地：startWindowsNativeSupervisor → orbit-executor → orbit-agentd / orbit-brokerd
```

## 4. UNKNOWN

- 各 schema 的完整字段；
- 流式/事件通道（带 id 的形态）在桌面 UI 的具体用法；
- 与原生 runtime 之间的 RPC 帧格式（P10 后续）。
