# 环境记录（P0 自检）

- 记录日期：2026-10-17
- 依据：手册《Intern InkStone：DSH Web 分析执行手册》v1.0 §2、§6
- 记录人（执行侧）：自动化助手，运行于 ModelArts / code-server 环境
- 结论：**P0 未通过**（见文末）。主控模型与分析工具链尚不可用。

## 主机与运行时

| 项目 | 实测值 | 备注 |
| --- | --- | --- |
| 操作系统 | Linux（Huawei ModelArts 容器，工作目录 `/home/ma-user/work`） | |
| Node（PATH 中） | `v24.7.0` (`/modelarts/authoring/notebook-conda/envs/jp4/bin/node`) | 与 dsh 实际使用的 Node 不同 |
| Node（dsh 实际运行时） | `v22.21.1` (`/modelarts/tools/code-server/lib/node`) | **低于 deepspider 要求的 `>=24.15.0`** |
| dsh | `0.1.1-rc.1`，入口 `/home/ma-user/.local/bin/dsh`（`#!/bin/sh` 包装脚本） | |
| pnpm | `11.7.0` | |
| git | `2.34.1` | |
| curl | `7.81.0` | |
| Python | `3.10.6` | |
| rg | **缺失** | 手册 §9 的本地检索命令需改用编辑器搜索或先装 rg |
| uv | **缺失** | deepspider `setup:crypto` 依赖 uv |
| jq | 缺失 | |

## 网络

| 目标 | 结果 |
| --- | --- |
| `https://discovery.intern-ai.org.cn/chat/` | HTTP 200（经代理可达） |
| `https://discovery-api.intern-ai.org.cn/v1/` | HTTP 404（该根路径无内容，符合预期） |
| `https://registry.npmjs.org/` | HTTP 200 |
| 代理 | `http_proxy=https_proxy=http://127.0.0.1:9999`（另有 `no_proxy` 华为云白名单） |

**注意**：出网依赖本机 127.0.0.1:9999 代理；正式执行 P1 前需确认代理不会改写/拦截目标站请求（尤其 SSE/WebSocket）。

## DSH Profile 现状

现有 Profile：`dsh-tui`、`headless`、`web`。

- `web` 已安装本手册所需的主力插件（deepspider、dsh-plugin-reverse、dsh-reverse-skill、dsh-rea、dsh-browser-agent 等，见 tool-inventory.md）。
- **`web` Profile 目前无法加载插件树**（两个独立阻断，详见 task-state.md 的阻塞项 B1/B2）。

## 与手册命令的版本差异（执行前必须知晓）

1. 手册 §2.4 的初始化命令
   `dsh --profile inkstone-re --from-default-profile web --dump-config`
   在 `dsh 0.1.1-rc.1` **不支持**：`--from-default-profile` 不在 `--help`，实际报
   `profile "inkstone-re" does not exist; create it with 'dsh plugin --profile inkstone-re add <package>'`。
   本机可用的建档方式为 `dsh plugin --profile <name> add <package>`。
2. deepspider README 要求 Node `>=24.15.0`，而 dsh 实际以 Node `22.21.1` 运行（引擎门槛不满足，属未验证风险）。

## 环境修复记录（2026-10-17）

| 项 | 处理 | 结果 |
| --- | --- | --- |
| B1 schemastery | `pnpm add schemastery@^3.18.0` 写入 web/profile | cheatengine 模块可加载 |
| B2 hmr | 在 web `cordis.patch.yml` 用户层重新启用 hmr；并把 `@deepseek-ai/cordis-plugin-hmr` 指向 harness 自带 `vendor/hmr@1.0.16`（含 `registerConfig`），替代 profile 里不兼容的 1.0.19 | **`web` 与 `inkstone-re` 均可正常启动**（`dsh web: http://127.0.0.1:3080`） |
| B4 浏览器 | `patchright install chromium` 下载 chromium-1248 + headless-shell | 浏览器可用 |
| Profile | 新建 `inkstone-re`（bundles: base, web-app, deepspider, dsh-plugin-reverse, reverse-skill, browser-agent）与 `inkstone-re-headless` | `inkstone-re` 启动成功 |
| 重装防护 | `web/package.json` 增加 `pnpm.overrides` 指向 vendor/hmr；`pnpm-workspace.yaml` 的 allowBuilds 占位符修正为 `true` | 防止重装回退 |

> 注意：`inkstone-re/` 与 `inkstone-re-headless/` 的 `node_modules` 为符号链接，复用 `web/` 已装好的插件树，未再触发长安装。

## 依赖安装记录（2026-10-17，用户授权自行安装）

> 容器禁用 sudo（`no_new_privileges`），apt 不可用；改用用户级渠道（静态二进制 / pip / 镜像）。

| 依赖 | 渠道 | 结果 |
| --- | --- | --- |
| ripgrep | GitHub release 静态二进制 → `~/.local/bin/rg` | ✅ 14.1.1 |
| jq | GitHub release 静态二进制 → `~/.local/bin/jq` | ✅ 1.7.1 |
| uv | `pip install --user uv` | ✅ 0.13.1 |
| OpenJDK 21 | 华为云镜像 → `~/.local/opt/jdk-21.0.2`，软链 `~/.local/bin/java` | ✅ 21.0.2 |
| Chromium | `patchright install chromium` | ✅ chromium-1248 + headless-shell |
| deepspider crypto 环境 | `uv venv .venv --python 3.11` + `requirements-crypto.txt` | ✅ py3.11，10 个包导入通过 |
| Ghidra 12.1.4 | ghfast.top 镜像 → `~/.local/opt/ghidra_12.1.4_PUBLIC`（+JDK21） | ✅ `analyzeHeadless` 分析 /bin/true 成功 |
| IDA Pro / Cheat Engine / x64dbg | 无可用安装渠道（商业授权 / 仅 Windows） | ❌ 不可安装 |

## P0 通过检查（手册 §6）—— 复测

- [x] DSH 至少完成一次正常模型请求 —— **通过**（`dsh --profile headless "只回复 OK"` → `OK`）
- [x] 浏览器至少完成一次页面读取 —— **通过**（patchright/Chromium 打开目标页，标题 `书生·端砚 Intern InkStone`）
- [x] 已保存一份实际网络记录 —— **通过**（`01-evidence/sanitized/a0-network.json`，56 条）
- [ ] reverse 工具至少完成一次本地示例分析 —— **未通过**（`rev_*` 是 DSH 模型侧工具；见下）

### 关键能力缺口（如实记录）

- **deepspider / `rev_*` 等插件工具无法被非交互驱动**：deepspider 的 host 插件 `inject: ['agents','apiProxy']`，`apiProxy` 由 web-app 的 `api-gateway` 行提供；把 api-gateway 补进 headless 又要求 `directoryPicker`/`workspaceRegistry` 等一整套 web 服务（等于重建 web 层）。**结论：deepspider 工具只能运行在 Web UI 会话中，而 Web UI 需人工操作，当前无法自动化驱动。**
- 为在不虚构的前提下推进，浏览器读取改用 **patchright 直接驱动**（deepspider 底层同源），并明确标注为工具替换；`rev_*` 静态工具名已知（`rev_assess`/`rev_deobfuscate`/`rev_hook_generate`/`rev_extract_pure`/`rev_crypto_calc`），但未在可用运行时真正调用。

判定：P0 的「模型请求 / 浏览器读取 / 网络记录」三项已通过；「reverse 工具本地示例分析」仍**未通过**。A1 及之后的业务请求采集需要用户完成登录。
