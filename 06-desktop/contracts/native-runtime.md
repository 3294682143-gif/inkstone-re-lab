# 原生运行时（Go PE）静态地图（0.2.7）

- 证据：`resources/runtime/manifest.json` + 三份 Windows x64 Go PE（未执行）
- 确认等级：STATIC_CONFIRMED（清单/哈希/构建信息/字符串）；运行行为 UNKNOWN

## 1. 清单（resources/runtime/manifest.json）

| role | file | size | sha256 |
| --- | --- | ---: | --- |
| agent_runtime | orbit-agentd.exe | 57364184 | bb56db4a67df1da0f810624872322de399b76f016e508ad7b63f514b03ab1409 |
| broker | orbit-brokerd.exe | 29981920 | 827a58d163eb5dfd69aeef32098f0578a614d7d19902d36efdc16e352678e377 |
| executor | orbit-executor.exe | 22546136 | 2414747197eb7190ef9b21d149ac3a2037d3dbba0c1cc272c2adc9f2cb00b624 |

- `client_runtime_backend: go`，`platform: windows`，`arch: x64`，`bundle_build_id: 0.2.7-8dabffa00633`，`binary_version: 0.2.7`，`revision: 8dabffa00633`。
- 三份实算哈希与清单**逐一一致**（本轮校验）。

## 2. 构建信息（agentd，字符串级）

- `go1.24.13`；`GOOS=windows`；`GOARCH=amd64`。
- 模块路径 `github.com/MigoXLab/intern-inkstone`。
- 出现大量 `agent.* / turn.*` 字符串（`agent.history`、`agent.validate`、`turn.start`、`turn.event`、`agent.recovery`、`agent.durable`、`agent.capability`、`agent.session`、`agent.tool`……）→ 与 Electron 侧 RPC 边界呼应，属**线索**，方法签名/语义未展开 → UNKNOWN。

## 3. 启动与监督（Electron 侧入口）

- `startWindowsNativeSupervisor(executable, cwd, …)`（`M:40350`）：以 **executor** 为监督入口启动 agent/broker（`M:41545` `bundle.binaries["orbit-executor"]`；`M:42559` 再次启动/恢复）。
- 含状态目录、租约、恢复握手（`M:41505` 起）→ **不能按裸 CLI 随意拼参数**。

## 4. 与本轮的关系

- 本轮（Linux）只做静态：读清单、哈希、构建信息、字符串。**不启动任何 PE**。
- RPC 方法帧、取消/恢复/执行路径的下钻：需要进一步静态（符号/反汇编）与 Windows 动态验证 → P10 后续 / P9。
- 状态：`agentd/brokerd/executor` 的**职责**已知（清单 role），**协议细节 UNKNOWN**。
