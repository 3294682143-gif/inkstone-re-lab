# inkstone-re-lab

Intern InkStone（`https://discovery.intern-ai.org.cn/chat/`）聊天通信的**接口契约、SSE 解析器、最小客户端与回归脚本**。
本仓库同时保存分析证据与验证材料（`00-scope/` … `05-validation/`）。

> 说明：离线解析器、请求构造、离线测试与 `--help/--dry-run` **不需要浏览器，也不需要登录态，且不发网络请求**。
> 只有 `--live` 才会联网；只有浏览器采集脚本才需要 Chromium。

## 环境要求

- **Node.js >= 20**（使用了内置 `fetch`、`Response`、`ReadableStream`、`node:test`）。
- npm（随 Node）。
- 仅有一个运行时依赖：`undici`（用于可选的代理支持），随 `npm ci` 安装。

```bash
node --version   # 期望 >= v20
```

## 安装（可复现）

```bash
npm ci            # 依据 package-lock.json 精确安装
```

## 离线使用（无需登录态 / 不联网 / 不启动浏览器）

```bash
# 帮助（退出码 0）
node src/client.mjs --help

# 默认模式与 --dry-run 都是纯本地，不发任何网络请求
node src/client.mjs --dry-run

# 用脱敏样本离线解析一次响应
node src/client.mjs --dry-run --fixture fixtures/first-turn.json
# => { "mode": "fixture", "finished": true, "answer": "OK" }
```

## 运行测试

```bash
npm test          # 等价于 node --test
```

测试全部为离线测试（依赖注入 + 模拟传输），**不访问真实站点、不使用真实凭据、不启动浏览器**。

## 在线使用（需要本人有效登录态）

登录态文件由本人在本地导出（Playwright/patchright 的 `storageState` JSON）。**不要把 Cookie/Token 或文件内容提交或粘贴。**

```bash
# 创建新会话并发送第一条消息
node src/client.mjs --live --scenario new-conversation \
  --text "INKSTONE-RE-LIVE-01：请只回复 OK。" \
  --storage-state 01-evidence/private/inkstone-auth.json

# 在上一次真实返回的会话下追问
node src/client.mjs --live --scenario follow-up \
  --conversation-id <上一轮真实返回的会话 id> \
  --text "请复述我上一条消息中的测试标记。" \
  --storage-state 01-evidence/private/inkstone-auth.json
```

回归（n 组独立新会话，每组两轮）：

```bash
node src/regress.mjs --n 3 --mark INKSTONE-RE-REG \
  --storage-state 01-evidence/private/inkstone-auth.json \
  --out 05-validation/<本轮目录>/regression.json
```

## 退出码

| 码 | 含义 |
| --- | --- |
| 0 | 成功 |
| 1 | 运行失败：HTTP 非成功、非 SSE、业务失败、**流未正常结束**（缺 `workflow_finished`） |
| 2 | 参数错误：未知参数、缺值、无效场景、`--dry-run` 与 `--live` 冲突、`--n` 非正整数 |

判定规则：
- 只有收到协议规定的正常结束事件 `workflow_finished` 才算成功；EOF 提前到来判失败（保留部分回答用于诊断）。
- 普通错误 JSON / HTML **不会**被当作正常 SSE 成功处理。
- 回归中任一组失败即整体失败；`--n` 必须是大于 0 的整数。

## 配置与环境变量

**本程序不会自动加载 `.env` 文件。** 请用 shell 导出（`export ...`）或命令行参数传入。

| 变量 | 对应参数 | 默认 | 说明 |
| --- | --- | --- | --- |
| `INKSTONE_BASE_URL` | `--base-url` | `https://discovery.intern-ai.org.cn` | 接口基址 |
| `INKSTONE_STORAGE_STATE` | `--storage-state` | `01-evidence/private/inkstone-auth.json` | 登录态文件（仅 `--live` 读取） |
| `INKSTONE_PROXY` | `--proxy` | 空 | 代理；**未配置时直连** |
| `INKSTONE_TIMEOUT_MS` | `--timeout-ms` | `60000` | 请求/读取超时；`0` 表示不超时 |

- 代理仅在**明确配置**时启用；也兼容标准 `HTTPS_PROXY` / `HTTP_PROXY`。**不再默认强制任何代理地址。**
- `--help` 与 `--dry-run`/默认模式不读取登录态、不联网。

## 浏览器采集（可选，单独安装）

`src/` 下的 `collect.mjs`、`a0_capture.mjs`、`a1_send.mjs`、`capture_chat.mjs`、`a3a4.mjs`、`dump_headers.mjs`、`verify_login.mjs`、`fetch_sources.mjs` 依赖 **patchright + Chromium**，用于浏览器侧取证（A0–A4）。它们**不参与**离线解析与测试，也不被 `npm ci` 安装。

```bash
npm i -D patchright          # 仅安装库
npx patchright install chromium   # 下载浏览器（体积较大）
export INKSTONE_PROXY=http://127.0.0.1:9999   # 如确实需要代理；否则直连
node src/collect.mjs --scenario A0           # 示例
```

未安装 patchright 时，这些脚本会给出明确安装提示，不影响其他功能。

## 目录

```
src/
  args.mjs               参数解析（布尔 vs 取值）
  net.mjs                网络层（undici；代理可选；读 storageState）
  chat-session.mjs       会话层（HTTP/CT/业务/结束 校验；超时；清理）
  stream-parser.mjs      SSE 解析 + 增量合并
  build-chat-request.mjs 请求构造
  client.mjs             最小客户端 CLI（可注入测试）
  regress.mjs            回归脚本（可注入测试）
  browser-lib.mjs        浏览器脚本共享工具（可选 patchright）
  <采集脚本>.mjs          浏览器侧取证（可选）
tests/                   离线测试（node:test）
fixtures/                脱敏样本
04-contracts/            接口契约与事件协议
05-validation/           验证与验收材料
```

## 依赖与限制

- 依赖：`undici`（见 `package.json` / `package-lock.json`）。
- 未使用 DeepSpider / `rev_*` 等插件做本轮分析（其为本机 DSH Web UI 内的模型侧工具，不可非交互驱动）；静态检索用 ripgrep 完成。
- A5（停止生成）与 A6（模型/选项切换）未取证，保持未完成。
