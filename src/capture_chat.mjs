// A1+A2：同一 BrowserContext 内，新建会话发送 A1 标记，再在**同一会话**追问 A2；
// 全量捕获 chat/new 请求与响应、发送请求体、SSE 事件流、标题调用。
// 原始件写 01-evidence/private/；脱敏摘要写 01-evidence/sanitized/。stdout 只打印脱敏摘要。
//
// 用法:
//   node src/capture_chat.mjs --storage-state 01-evidence/private/inkstone-auth.json \
//        --a1 "INKSTONE-RE-A1：请只回复 OK。" --a2 "请复述我上一条消息中的测试标记。"
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { launchProxy, loadPatchright, resolveBrowserProxy } from './browser-lib.mjs';

const _pw = await loadPatchright();
const chromium = _pw.chromium ?? _pw.default?.chromium;

function arg(n, d=undefined){ const i=process.argv.indexOf(`--${n}`); return i>=0?(process.argv[i+1]??true):d; }
const STORAGE = arg('storage-state', '01-evidence/private/inkstone-auth.json');
const A1 = arg('a1', 'INKSTONE-RE-A1：请只回复 OK。');
const A2 = arg('a2', '请复述我上一条消息中的测试标记。');
const PROXY = resolveBrowserProxy(process.env);
const HOME = 'https://discovery.intern-ai.org.cn/chat/';
mkdirSync('01-evidence/private', {recursive:true});
mkdirSync('01-evidence/sanitized/streams', {recursive:true});
if (!existsSync(STORAGE)) { console.log(JSON.stringify({error:'storage-state not found'})); process.exit(2); }

const raws = { reqs: {}, resps: [], streams: {} };
const sanitize = (s) => String(s).replace(/[A-Za-z0-9_-]{24,}/g, '<BLOB>');

const browser = await chromium.launch({ headless: true, ...launchProxy(PROXY) });
const context = await browser.newContext({ storageState: STORAGE });

// 请求体
context.on('request', (rq) => {
  if (rq.method()==='POST' && rq.url().includes('/api/')) {
    const p = new URL(rq.url()).pathname;
    raws.reqs[`POST ${p} #${Object.keys(raws.reqs).length}`] = {
      path: p, contentType: rq.headers()['content-type']||'', postData: rq.postData()||'' };
  }
});
// 响应 + SSE 流
const sseJobs = [];
context.on('response', (res) => {
  const u = res.url(); const ct = res.headers()['content-type']||'';
  raws.resps.push({ url: u, status: res.status(), ct });
  if (/text\/event-stream/.test(ct)) {
    sseJobs.push((async () => {
      try { const buf = await res.body(); const t = Buffer.from(buf).toString('utf8'); raws.streams[new URL(u).pathname + '_' + Date.now()] = t; }
      catch(e) { raws.streams[new URL(u).pathname + '_ERR'] = 'read failed: '+e.message; }
    })());
  }
});

const page = await context.pages()[0] ?? await context.newPage();
await page.goto(HOME, { waitUntil:'networkidle', timeout:60000 });
await page.waitForTimeout(4000);

async function findInput() {
  const cand = page.locator('textarea, [contenteditable="true"], input[type="text"]');
  const n = await cand.count();
  for (let i=n-1;i>=0;i--){ const el=cand.nth(i); if (await el.isVisible().catch(()=>false)) return {el, i, n}; }
  return null;
}
async function send(text) {
  const f = await findInput();
  if (!f) return {ok:false, reason:'no input'};
  await f.el.click(); await f.el.fill(text); await page.waitForTimeout(400);
  await f.el.press('Enter');
  await page.waitForTimeout(1500);
  // 若回车无效，点按钮
  // 等一个 POST /api/orbit 响应
  try { await page.waitForResponse(r=>r.request().method()==='POST'&&r.url().includes('/api/orbit/v1/chat'), {timeout:40000}); }
  catch { const b=page.locator('button',{hasText:/开始探索|发送|提交|Send|Submit/}); if(await b.count()){await b.first().click().catch(()=>{});} }
  await page.waitForTimeout(1000);
  return {ok:true, inputIndex:f.i, candidates:f.n};
}

// A1
const a1res = await send(A1);
// 等待 SSE 结束（标题调用出现表示本轮基本完成）
await page.waitForResponse(r=>/\/chat\/\d+\/title/.test(r.url()), {timeout:60000}).catch(()=>{});
await page.waitForTimeout(6000);

// 提取会话 id（从 title 或 chat/new 响应体）
let convId = null;
for (const r of raws.resps) { const m = r.url.match(/\/chat\/(\d+)\/title/); if (m) convId = m[1]; }
if (!convId) { for (const [k,v] of Object.entries(raws.reqs)) { try { const j=JSON.parse(v.postData); } catch{} } }

// A2（同一会话追问）
const a2res = await send(A2);
await page.waitForTimeout(8000);

await Promise.allSettled(sseJobs);
await page.waitForTimeout(1500);

writeFileSync('01-evidence/private/a1a2-raw.json', JSON.stringify(raws, null, 2));

// —— 脱敏摘要 ——
function keysOf(b){ try{ const j=JSON.parse(b); return Array.isArray(j)?`array[${j.length}]`:Object.keys(j);}catch{return null;} }
function sseShape(t){
  const events = t.split(/\n\n/).filter(Boolean);
  const types = {}; let dataKeys=null, doneMark=false, sampleTypes=[];
  for (const ev of events){
    const lines = ev.split('\n');
    const ef = lines.find(l=>l.startsWith('event:'));
    const df = lines.find(l=>l.startsWith('data:'));
    const t2 = ef? ef.slice(6).trim() : '(no-event)';
    types[t2]=(types[t2]||0)+1;
    if (df){ const d=df.slice(5).trim(); if (d==='[DONE]') doneMark=true; else { try{ const j=JSON.parse(d); dataKeys = dataKeys||new Set(); Object.keys(j).forEach(k=>dataKeys.add(k)); }catch{} } }
  }
  return { eventCount: events.length, eventTypes: types, dataKeys: dataKeys?[...dataKeys]:null, hasDoneMarker: doneMark,
    headSanitized: sanitize(t.slice(0, 600)) };
}

const streamsSummary = {};
for (const [k,v] of Object.entries(raws.streams)) {
  if (/ERR/.test(k) || typeof v !== 'string') { streamsSummary[k]=v; continue; }
  streamsSummary[k]=sseShape(v);
}
const reqSummary = Object.values(raws.reqs).map(r=>({ path:r.path, contentType:r.contentType, postDataKeys:keysOf(r.postData), postDataHasA1: r.postData.includes(A1), postDataHasA2: r.postData.includes(A2) }));

const summary = { a1res, a2res, conversationId: convId,
  requests: reqSummary,
  responses: raws.resps.map(r=>({ path:(()=>{try{return new URL(r.url).pathname;}catch{return r.url;}})(), status:r.status, ct:r.ct })),
  streams: streamsSummary };
writeFileSync('01-evidence/sanitized/a1a2-summary.json', JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
await browser.close();
