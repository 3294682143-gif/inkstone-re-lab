# 07-handoff — Linux → Windows 交接

本目录是 Linux 阶段的交接入口，供 Windows 本机按**固定提交**取回并继续动态验证。

## 平台状态（不混层）

| 层 | 状态 | 说明 |
| --- | --- | --- |
| Linux 离线测试 | PASS | `npm test`（见 validation 目录实际统计） |
| Linux mock runner | PASS（MOCK） | `scripts/windows-driver-smoke.mjs --mock` 各场景可运行；标记 MOCK |
| 桌面真实推理（Linux） | NOT_RUN | 载荷元素结构 UNKNOWN，不构造猜测请求 |
| Windows 动态 | 未执行 | 需同版本应用 + 同一 Windows 用户登录 |

## 交付内容

- `handoff.json`：固定源码版本、验证、样本与工具元数据。
- `windows-todo.md`：L2 未知项对应的 Windows 采集任务（字段/入口/动作/观察点/判据）。
- 运行器：`scripts/windows-driver-smoke.mjs`（场景 preflight/discovery/chat/cancel）。
- 传输层：`src/desktop/driver-process.mjs`（子进程 JSONL，复用 `driver-jsonl.mjs` 的 framer/correlator）。
- 离线 mock 驱动：`tests/fixtures/mock-headless-driver.mjs`。

## Linux 侧命令（离线，MOCK）

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm test
node scripts/windows-driver-smoke.mjs --help
node scripts/windows-driver-smoke.mjs --mock --preflight                      --out /tmp/h/preflight
node scripts/windows-driver-smoke.mjs --mock --scenario discovery             --out /tmp/h/discovery
node scripts/windows-driver-smoke.mjs --mock --scenario chat   --project p --model m --out /tmp/h/chat
node scripts/windows-driver-smoke.mjs --mock --scenario cancel --project p --model m --out /tmp/h/cancel
```

## Windows 侧命令（正式 exe；先安装依赖并登录桌面应用）

```powershell
$env:INKSTONE_PYTHON = "<python.exe 完整路径>"
npm.cmd ci --ignore-scripts --no-audit --no-fund
npm.cmd test
node scripts/windows-driver-smoke.mjs --help
node scripts/windows-driver-smoke.mjs --preflight --exe <桌面应用.exe> --out <目录>
node scripts/windows-driver-smoke.mjs --exe <exe> --scenario discovery --out <目录>
node scripts/windows-driver-smoke.mjs --exe <exe> --scenario chat   --project <项目> --model <模型> --out <目录>
node scripts/windows-driver-smoke.mjs --exe <exe> --scenario cancel --project <项目> --model <模型> --out <目录>
```

> 正式模式启动的是**桌面应用主 exe**（参数 `--headless-chat-driver`），不是 agentd/brokerd/executor，也不是安装包。
> 先在同一 Windows 用户下用桌面应用完成一次登录；`session.create` 使用 `cleanup:false`。
> `turn.stop` 只表示本地停止请求；不从流关闭推断服务端停止或计费。

## 取回固定版本

```powershell
git clone --branch re/linux-windows-handoff https://github.com/3294682143-gif/inkstone-re-lab.git
git fetch origin --tags
git switch --detach <HANDOFF_SHA>
```
