# 06-desktop — Intern InkStone 桌面端（0.2.7）逆向

面向 **Linux 静态逆向 + 纯 Node 离线实现**。Windows 实机动态验证单列 P9，状态 `BLOCKED / ENV_WINDOWS_REQUIRED`。

## 样本

- `inkstone-desktop-0.2.7-setup.exe`，285650528 字节，SHA256 `eb8ef2da7c67df4fd2728a686cf84c1699fa410746af2d5b08f6e9b89d6dfcd8`
- 原始包与完整解包**不入公开仓库**，放在 `01-evidence/private/desktop-027/`（`.gitignore` 已忽略）。
- 哈希与校验链：`evidence/sample-manifest.json`

## 可复现拆包（Linux）

```bash
# 0) 前置：7-Zip 26.04（无 sudo，放 private 工具目录）
TOOL=01-evidence/private/desktop-027/tools/7zip-26.04
mkdir -p "$TOOL"
curl -fsSL 'https://github.com/ip7z/7zip/releases/download/26.04/7z2604-linux-x64.tar.xz' -o "$TOOL/7zip.tar.xz"
tar -xJf "$TOOL/7zip.tar.xz" -C "$TOOL"          # 得到 $TOOL/7zz

INST=01-evidence/private/desktop-027/input/inkstone-desktop-0.2.7-setup.exe
RAW=01-evidence/private/desktop-027
"$TOOL/7zz" x -y "-o$RAW/installer" "$INST" '$PLUGINSDIR/inkstone-app.7z'
"$TOOL/7zz" x -y "-o$RAW/payload" "$RAW/installer/\$PLUGINSDIR/inkstone-app.7z" \
  'resources/app.asar' 'resources/runtime/*' 'resources/app-update.yml'

# 1) 提取应用自有 ASAR（不执行应用代码）
python3 tools/inspect_inkstone_asar.py \
  --asar "$RAW/payload/resources/app.asar" \
  --out  "$RAW/asar" \
  --manifest 06-desktop/evidence/asar-manifest.json
```

预期：`{"total_entries":6035,"extracted":181}`；主 bundle 哈希 `f4b8148d…`。

> `$PLUGINSDIR` 是字面路径，不要让 shell 替换。

## 离线实现（纯 Node，不 import electron）

```
src/desktop/gateway-events.mjs   桌面 SSE `type` 事件解析 + GatewayEventSequence + 合并器 + SSE 分帧
src/desktop/driver-jsonl.mjs     headless JSONL 分帧 + 严格请求解析 + 关联器（accepted ≠ completed）
src/desktop/models-contract.mjs  /local-agent/models 能力目录契约（protocol_version "2.0"）
src/desktop/cloud-adapter.mjs    可注入 fetch 的 HTTP adapter（chat/new、models、messages、local-turns）
```

离线验收命令（**无需登录态、不联网、不启动 Electron**）：

```bash
npm ci
npm test
node --test tests/desktop/*.test.mjs   # 仅桌面模块
```

合成样本：`fixtures/desktop/*.synthetic.*`（均标注 synthetic）。

## 契约

`contracts/architecture.md`、`ipc.md`、`auth-state.md`、`cloud-gateway.md`、`driver-jsonl.md`、`native-runtime.md`。

## 状态

| 阶段 | 状态 |
| --- | --- |
| P6.1 基线收尾（fixture flush / 证据写入退出码） | PASS |
| P7 桌面静态地图 | PASS（STATIC_CONFIRMED；证据见 `evidence/`） |
| P8 Linux 离线实现 | PASS（`tests/desktop` 全绿） |
| P10 原生静态补充（轻量） | 部分（构建信息/字符串/职责；RPC 细节 UNKNOWN） |
| P9 Windows 动态闭环 | **BLOCKED / ENV_WINDOWS_REQUIRED** |

详见 `validation/2026-10-18-linux-static/results.json`。
