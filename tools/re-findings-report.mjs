// tools/re-findings-report.mjs
// 由结构化数据生成“逆向成果”报告页（单文件 HTML，无外部依赖）。
// 数据均来自本仓库已完成的分析证据（06-desktop/contracts/*、evidence/*）。
// 证据等级：STATIC_CONFIRMED / MOCK_VERIFIED / LIVE_VERIFIED / INFERRED / UNKNOWN

const META = {
  title: 'Intern InkStone 桌面端 0.2.7 · 逆向成果总览',
  sample: {
    file: 'inkstone-desktop-0.2.7-setup.exe', size: '285650528 B',
    sha256: 'eb8ef2da7c67df4fd2728a686cf84c1699fa410746af2d5b08f6e9b89d6dfcd8',
  },
  chain: [
    ['$PLUGINSDIR/inkstone-app.7z', '244208333603a4c0bc2c677c2e7e4abf1cc975b1c970a3fdb15d4018437a4040'],
    ['resources/app.asar', '10c286f32211bcf2dc05f9ea4bbcf3e982627be2b92f2bc656503eec7535ad77'],
    ['out/main/index-CYl10ENn.js（主 bundle，下称 M）', 'f4b8148db01e9a196c28dd68d94761d715b834ee2fec3af861fe8ddec665acab'],
    ['out/preload/index.cjs', '4303ea1ad183de0791a216970adbe941068420adf8729c0d65c0668e7ed39d4a'],
  ],
  runtime: [
    ['orbit-agentd.exe', '57364184', 'bb56db4a67df1da0f810624872322de399b76f016e508ad7b63f514b03ab1409'],
    ['orbit-brokerd.exe', '29981920', '827a58d163eb5dfd69aeef32098f0578a614d7d19902d36efdc16e352678e377'],
    ['orbit-executor.exe', '22546136', '2414747197eb7190ef9b21d149ac3a2037d3dbba0c1cc272c2adc9f2cb00b624'],
  ],
};

const SECTIONS = [
  {
    id: 'base', title: '基址与配置', level: 'STATIC_CONFIRMED',
    rows: [
      ['Core API 基址', 'https://discovery.intern-ai.org.cn/api/orbit/v1', 'M:4842'],
      ['通用/认证/SCP API', '/api、/api/user-center/v1、/api/moce/v1', 'M:3784'],
      ['更新源', 'https://static.openxlab.org.cn/releases/inkstone/', 'M:4828 / app-update.yml'],
      ['SSO', 'sso.openxlab.org.cn，client_id dagw07mkg1bazlxzoy31，source discovery', 'M:3784'],
    ],
  },
  {
    id: 'endpoints', title: '云端 gateway 端点（桌面主链）', level: 'STATIC_CONFIRMED',
    rows: [
      ['POST /chat/new', '创建会话；体 {scenario:2,type:0,provider:0,agent:"local_agent"}；返回 data.id(正整数)', 'M:36948'],
      ['GET /local-agent/models', '模型能力目录；要求 protocol_version="2.0"', 'M:37075 / M:38718'],
      ['POST /local-agent/messages', '主要推理路径；SSE（Content-Type: text/event-stream）', 'M:37727'],
      ['POST /chat/{id}/local-turns', '轮次开始 → {turn_id,message_id,status,checkpoint_seq}', 'M:38034'],
      ['POST /chat/{id}/local-turns/{turnId}/checkpoint', '检查点 → {applied(bool),status,checkpoint_seq}', 'M:38045'],
      ['POST /chat/{id}/local-turns/{turnId}/complete', '完成 → {turn_id,message_id,status,checkpoint_seq,usage}', 'M:38059'],
      ['请求身份头', 'Authorization: Bearer <token>；id: <ssoUid>；Accept-Language；credentials:"omit"', 'M:38165 / M:38102'],
    ],
  },
  {
    id: 'events', title: '推理事件协议（SSE，字段为 type）', level: 'STATIC_CONFIRMED',
    rows: [
      ['message_start', 'type,response_id,model', 'M:38593'],
      ['thinking_delta / content_delta', 'type,text（增量）', 'M:38593'],
      ['tool_use_start', 'type,id,name', 'M:38593'],
      ['tool_input_delta', 'type,id,partial_json（增量）', 'M:38593'],
      ['tool_use_end', 'type,id,input?', 'M:38593'],
      ['usage', 'type,usage{input_tokens,output_tokens,cache_read_tokens?,cache_write_tokens?}', 'M:38593'],
      ['message_end', 'type,stop_reason ∈ end_turn|tool_use|max_tokens|stop_sequence', 'M:38660'],
      ['error', 'type,code,message,retryable', 'M:38680'],
      ['序列规则', '必须以 message_start 开始；usage≤1 且其后只能 message_end；message_end 前必须有 usage；error 终止；不得无终止结束', 'M:38554'],
    ],
  },
  {
    id: 'inference', title: '推理请求契约（gateway.inference.start）', level: 'STATIC_CONFIRMED / 边界 UNKNOWN',
    rows: [
      ['发出前转换', 'providerRequest={...payload}；delete lifecycle_owner；JSON.stringify', 'M:37138'],
      ['必填字段', 'protocol_version=2.0、inference_kind(turn|detached)、lifecycle_owner、chat_id(正整数)、turn_id|inference_id、request_id、model、messages[]、tools[]', 'M:38977'],
      ['admission', 'model 精确匹配 1 个能力；limits: max_messages / max_tools / max_request_bytes', 'M:37149'],
      ['身份/并发', 'scopeKey=chatId\\0kind\\0identity；leaseKey=chatId\\0parent；duplicate_request；retired 上限 256', 'M:38990 / M:37133'],
      ['★ 应用↔运行时边界', '应用 JS 调运行时 turn.start（coreStartRequest：query/model/mode/permissionMode/contextReferences…，无 messages/tools）；messages/tools 由原生运行时→gateway 生成', 'M:56606-56722'],
      ['messages/tools 元素结构', 'UNKNOWN（应用 JS 无构造来源；检索全部 180 文件）', '—'],
    ],
  },
  {
    id: 'localturn', title: 'local-turn 标识符生命周期', level: 'STATIC_CONFIRMED（接收端）/ 请求体 UNKNOWN',
    rows: [
      ['chatId', '服务端 /chat/new 返回的正整数', 'M:36948'],
      ['request_id', '客户端/运行时 host.createId()；关联 turn.completed/turn.failed 与 turn.stop', 'M:117999'],
      ['turn_id', '服务端/事件；^[A-Za-z0-9_-]{1,160}$；回合内恒等；用于 checkpoint/complete URL', 'M:31182'],
      ['message_id', '服务端返回正整数', 'M:38034'],
      ['checkpoint_seq', '服务端返回非负整数', 'M:38045'],
      ['status 枚举', 'running | complete | stopped | error（turnStatus）', 'M:39110'],
      ['请求体构造来源', 'UNKNOWN（local-turns/conversation.* 仅出现在接收端与允许清单）', '—'],
    ],
  },
  {
    id: 'cancel', title: '停止 / 取消 / 冲突恢复', level: 'STATIC_CONFIRMED',
    rows: [
      ['turn.stop（运行时）', '载荷 {requestId, expectedTurnId}；要求 result.stopped===true', 'M:56786'],
      ['stopAndDrainHeadlessTurn', 'stopTurn 后轮询 history 至 activeRequestId≠requestId；上限 5000ms / 间隔 100ms', 'M:118069'],
      ['gateway.inference.cancel', '载荷 {requestId,streamId}；stream_not_found/stream_mismatch；返回 {cancelled:true|false}', 'M:37241'],
      ['drain 超时', 'INFERENCE_DRAIN_TIMEOUT_MS=2500；INDEPENDENT_REVIEW_DRAIN_TIMEOUT_MS=30000', 'M:36711'],
      ['recoveryProof', 'cancelled 且 retired.semanticTerminal==="message_end" 时写 drainedInferences{drainedAt}（容量 256）', 'M:37280'],
      ['409 冲突码', '409001 TURN_CONFLICT→TURN_CONFLICT_RECOVERY；409005 INFERENCE_ALREADY_RUNNING(retryable)→INFERENCE_LEASE_RECOVERY；ambiguous 必须 false', 'M:39046'],
      ['canRecover', 'drain proof 异 id、age≤5000ms、未抑制/取消/关闭/兄弟；重试间隔 750ms', 'M:37301 / M:39054'],
      ['事件顺序', '正常序 accepted 先于终态；stdout 单一不能据以断言乱序；保留有界乱序缓存', 'M:117992'],
      ['边界', '不因本地 abort 推断服务端已停止或计费结果（UNKNOWN）', '—'],
    ],
  },
  {
    id: 'ipc', title: 'IPC 与认证', level: 'STATIC_CONFIRMED',
    rows: [
      ['IPC 传输', 'namespace inkstone-desktop；通道 @aderra/tipc:inkstone-desktop:invoke；载荷 {route,input}', 'preload:67/300/319'],
      ['ChatFeature 路由', 'listModels/startTurn/stopTurn/getHistory/controlTurn/decide（zod 校验）', 'M:66252'],
      ['凭据存储', 'SecureAuthCredentialStore + Electron safeStorage；旧凭据迁移', 'M:62492 / M:117161'],
      ['headless 登录前提', 'auth.getState().status!=="authenticated" → SSO_REQUIRED', 'M:119018'],
    ],
  },
  {
    id: 'native', title: '原生运行时（Go PE，静态）', level: 'STATIC_CONFIRMED（清单）/ RPC UNKNOWN',
    rows: [
      ['manifest', 'backend=go，windows/x64，bundle_build_id=0.2.7-8dabffa00633', 'resources/runtime/manifest.json'],
      ['agentd 构建', 'go1.24.13 / GOOS=windows / GOARCH=amd64；模块 github.com/MigoXLab/intern-inkstone', '字符串'],
      ['监督器', 'startWindowsNativeSupervisor → orbit-executor 启动 agent/broker', 'M:40350'],
      ['RPC 帧/取消/恢复细节', 'UNKNOWN', '—'],
    ],
  },
  {
    id: 'local', title: '已实现的离线成果（本仓库）', level: 'MOCK_VERIFIED',
    rows: [
      ['Web 客户端/回归', 'src/client.mjs、src/regress.mjs（新建/发送/追问/回归）', 'tests/'],
      ['SSE 解析（Web/桌面）', 'src/stream-parser.mjs、src/desktop/gateway-events.mjs', 'tests/desktop/gateway-*'],
      ['JSONL 关联', 'src/desktop/driver-jsonl.mjs（session 核对/乱序/终态）', 'tests/desktop/driver-jsonl*'],
      ['会话适配', 'src/desktop/cloud-adapter.mjs（超时/取消/契约校验）', 'tests/desktop/cloud-adapter*'],
      ['取消/恢复', 'src/desktop/cancel.mjs、src/desktop/recovery.mjs', 'tests/desktop/cancel*'],
      ['本地 mock + 演示页', 'tools/mock-gateway.mjs（/、/chat、/debug）', 'tests/desktop/mock-gateway*'],
    ],
  },
  {
    id: 'unknown', title: '仍未知 / 未执行 / 阻塞', level: 'UNKNOWN / NOT_RUN / BLOCKED',
    rows: [
      ['messages/tools 元素结构', 'UNKNOWN（原生/gateway 侧）', '—'],
      ['local-turn 请求体构造', 'UNKNOWN', '—'],
      ['原生 RPC 帧/取消/恢复', 'UNKNOWN', '—'],
      ['R4 推理首轮/追问/在线取消', 'NOT_RUN（载荷结构未确认，不构造猜测请求）', '—'],
      ['Windows 桌面动态闭环', 'BLOCKED / ENV_WINDOWS_REQUIRED', '—'],
      ['Web A5/A6', 'NOT_RUN', '—'],
    ],
  },
];

const LEVEL_COLOR = {
  'STATIC_CONFIRMED': '#3aa675', 'MOCK_VERIFIED': '#5b8cff', 'LIVE_VERIFIED': '#c9a227',
  'INFERRED': '#a06bd6', 'UNKNOWN': '#8b93a7', 'NOT_RUN': '#8b93a7', 'BLOCKED': '#c0563a',
};

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const badge = (lvl) => lvl.split('/').map((x) => x.trim()).map((x) => `<span class="lv" style="--c:${LEVEL_COLOR[x] || '#8b93a7'}">${esc(x)}</span>`).join(' ');

export function renderReportHtml() {
  const sections = SECTIONS.map((s) => `
  <section id="${s.id}">
    <h2>${esc(s.title)} ${badge(s.level)}</h2>
    <table><tbody>
      ${s.rows.map(([k, v, e]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td><td class="ev">${esc(e)}</td></tr>`).join('')}
    </tbody></table>
  </section>`).join('');

  const nav = SECTIONS.map((s) => `<a href="#${s.id}">${esc(s.title)}</a>`).join(' · ');
  const chain = META.chain.map(([f, h]) => `<tr><th>${esc(f)}</th><td class="mono">${esc(h)}</td></tr>`).join('');
  const rt = META.runtime.map(([f, s, h]) => `<tr><th>${esc(f)}</th><td>${esc(s)} B</td><td class="mono">${esc(h)}</td></tr>`).join('');

  return `<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(META.title)}</title>
<style>
:root{--bg:#0f1115;--panel:#161a22;--line:#262b36;--fg:#e8eaf0;--muted:#9aa3b2;--acc:#5b8cff}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.65 system-ui,Segoe UI,Arial}
header{padding:16px 20px;border-bottom:1px solid var(--line)}
h1{font-size:19px;margin:0 0 6px}header .sub{color:var(--muted);font-size:12.5px}
a{color:var(--acc)}nav{padding:10px 20px;border-bottom:1px solid var(--line);font-size:12.5px;color:var(--muted);position:sticky;top:0;background:var(--bg);z-index:2}
.wrap{max-width:1000px;margin:0 auto;padding:16px 20px 60px}
section{margin:22px 0}
h2{font-size:16px;border-left:3px solid var(--acc);padding-left:10px;margin:0 0 8px}
table{width:100%;border-collapse:collapse;background:var(--panel);border:1px solid var(--line);border-radius:10px;overflow:hidden}
th,td{padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top;text-align:left}
th{width:190px;color:#cfd6e4;font-weight:600}
td{color:#dbe1ec}td.ev{width:190px;color:var(--muted);font-size:12.5px;font-family:ui-monospace,Consolas,monospace}
td.mono{font-family:ui-monospace,Consolas,monospace;font-size:12px;color:#cfe3ff}
tr:last-child th,tr:last-child td{border-bottom:none}
.lv{display:inline-block;border:1px solid var(--c);color:var(--c);border-radius:10px;padding:0 7px;font-size:11.5px;margin-left:6px}
.tag{background:#3a1d1d;color:#ff8f8f;border:1px solid #5a2a2a;border-radius:10px;padding:1px 8px;font-size:12px}
.note{color:var(--muted);font-size:12.5px;margin:8px 0}
</style></head>
<body>
<header>
  <h1>${esc(META.title)} <span class="tag">STATIC / SYNTHETIC</span></h1>
  <div class="sub">样本 ${esc(META.sample.file)} · ${esc(META.sample.size)} · SHA256 <span class="mono">${esc(META.sample.sha256)}</span></div>
  <div class="sub">页面：<a href="chat">/chat 聊天演示</a> · <a href="debug">/debug 端点调试</a> · <a href="health">/health</a></div>
</header>
<nav>${nav}</nav>
<div class="wrap">
  <div class="note">证据等级：STATIC_CONFIRMED（源码明确）/ MOCK_VERIFIED（离线验证）/ LIVE_VERIFIED（真实目标）/ INFERRED / UNKNOWN。源码位置以主 bundle（哈希见下）原始行号为准。</div>
  <section id="sample"><h2>样本与哈希链</h2>
    <table><tbody>${chain}</tbody></table>
    <table style="margin-top:10px"><tbody>
      <tr><th>runtime manifest</th><td>backend=go · windows/x64 · bundle_build_id=0.2.7-8dabffa00633</td><td class="ev">manifest.json</td></tr>
      ${rt}
    </tbody></table>
  </section>
  ${sections}
  <div class="note" style="margin-top:20px">本页由 tools/re-findings-report.mjs 生成，数据来自 06-desktop/contracts 与 evidence。合成/离线演示，不含凭据。</div>
</div></body></html>`;
}
