# 工具清单（P0 自检）

- 记录日期：2026-10-17
- 分类：**实际可用** / **缺失** / **尚未验证**（手册 §6 要求三分）
- 说明：工具定义以当前运行环境为准；未启动成功前，插件工具一律记入「尚未验证」。

## 1. 分析主体：DSH 插件与工具

| 插件 | 版本 | 安装 | 合成入树 | 插件模块可加载 | 暴露工具（静态） | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| deepspider | 1.0.1 | ✅ | ✅ | ✅ | host/agent/preset 插件（工具名未静态确认） | **尚未验证**（运行时未起） |
| dsh-plugin-reverse | 0.1.0 | ✅ | ✅ | ✅ | `rev_assess` / `rev_deobfuscate` / `rev_hook_generate` / `rev_extract_pure` / `rev_crypto_calc` | **尚未验证** |
| @dhicoc/dsh-reverse-skill | 1.2.0 | ✅ | ✅ | ✅ | 57 个技能目录（SKILL.md 等） | **尚未验证** |
| dsh-rea | 1.2.0 | ✅ | ✅ | ✅ | REA 适配层（REA 本体不含） | **尚未验证** |
| @logictan/dsh-browser-agent | 0.2.2 | ✅ | ✅ | ✅ | `browser_agent`（需桥接服务 + Chrome 扩展） | **尚未验证** |
| @tindalosko/dsh-cheatengine | 0.5.2 | ✅ | ✅ | ❌ 缺 `schemastery` | —— | **不可用** |
| （背景）@anionex/dsh-turn-rewind, dsh-remote-ssh, dsh-browser, dsh-ghidra, dsh-re-workbench, dsh-infinite-gen-5 | —— | ✅ | ✅ | ✅ | —— | 第一轮不启用 |

> 关键事实：**本助手（执行侧）并不运行在 DSH 运行时内**，因此此刻无法调用 deepspider / `rev_*` / `browser_agent` 等模型侧工具。手册要求「先读取实际工具定义」，当前只能做到静态枚举，运行时枚举被 Profile 启动失败阻断（见 task-state.md B1/B2）。

## 2. 浏览器与抓取链路

| 能力 | 状态 | 证据 |
| --- | --- | --- |
| Chrome / Chromium 可执行文件 | **缺失** | `command -v google-chrome/chromium/...` 全部无 |
| Playwright/Patchright 浏览器缓存 | **缺失** | 无 `~/.cache/ms-playwright` |
| deepspider 依赖的 Chromium（`patchright install chromium`） | **未完成** | postinstall 未落地浏览器 |
| DevTools / HAR 导出 | **缺失** | 无浏览器，无法导出 |
| 出网 (curl) | 可用 | 代理 127.0.0.1:9999，目标 200 |

## 3. 外部逆向工具（第一轮不启用，但影响后续范围）

| 工具 | 状态 |
| --- | --- |
| ssh | ✅ 可用（dsh-remote-ssh 前提） |
| Java/JDK | ✅ 已装 OpenJDK 21.0.2 → `~/.local/bin/java`（华为云镜像） |
| Ghidra | ✅ 12.1.4（ghfast.top 镜像）→ `~/.local/opt/ghidra_12.1.4_PUBLIC`，软链 `~/.local/bin/ghidra`；`analyzeHeadless` 对 /bin/true **分析成功** |
| IDA Pro | ❌ 无法安装（商业授权，无安装渠道） |
| Cheat Engine | ❌ 无法安装（仅 Windows；本机 Linux） |
| x64dbg | ❌ 无法安装（仅 Windows） |

## 4. 基础命令行工具

| 工具 | 状态 |
| --- | --- |
| node | ✅ v24.7.0（PATH）/ v22.21.1（dsh 运行时） |
| pnpm | ✅ 11.7.0 |
| git | ✅ 2.34.1 |
| curl | ✅ 7.81.0 |
| python3 | ✅ 3.10.6 |
| rg (ripgrep) | ✅ 14.1.1（静态二进制 → `~/.local/bin/rg`） |
| uv | ✅ 0.13.1（pip --user 安装） |
| jq | ✅ 1.7.1（静态二进制 → `~/.local/bin/jq`） |
| deepspider Python crypto 环境 | ✅ `.venv`(py3.11) + pycryptodome/gmssl/rsa/pyDes/requests/httpx/PyExecJS/lxml/bs4/parsel |
| Chromium（patchright） | ✅ chromium-1248 + headless-shell |
| Java | ✅ OpenJDK 21.0.2 |

## 5. 「实际可用」净结论（2026-10-17 更新）

修复 B1/B2 并安装 Chromium 后的净结论：

| 能力 | 状态 |
| --- | --- |
| DSH 模型请求 | ✅ 可用（headless profile） |
| DSH web profile 启动（载入全部插件） | ✅ 可用（B1/B2 已修） |
| 浏览器页面读取 | ✅ 可用（patchright chromium-1248，**直接驱动**，非 deepspider 封装） |
| 网络记录 | ✅ 已采集 A0（`01-evidence/sanitized/a0-network.json`） |
| deepspider 插件工具 | ⚠️ 只能运行在 Web UI 会话，需人工操作 → 非交互不可驱动 |
| `rev_*` reverse 工具 | ❌ 未真正调用（同上） |
| 目标站登录态 | ❌ 缺失（A1 前置，需用户登录） |
| Ghidra/IDA/CheatEngine/x64dbg | ❌ 均未安装（第一轮不启用） |

原则遵守：安装成功 ≠ 运行成功；未执行的能力一律不写成已执行。
