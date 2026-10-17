// A1：以登录态打开聊天页，发送唯一标记文本，捕获真实发送请求与响应流。
// 原始网络记录（含 body）写入 01-evidence/private/；脱敏摘要写入 01-evidence/sanitized/。
// 只打印脱敏摘要，绝不把凭证/原文打印到 stdout。
// 用法: node src/a1_send.mjs --text "INKSTONE-RE-A1：请只回复 OK。" --storage-state 01-evidence/private/inkstone-auth.json
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { launchProxy, loadPatchright, resolveBrowserProxy } from './browser-lib.mjs';

const _pw = await loadPatchright();
const chromium = _pw.chromium ?? _pw.default?.chromium;

function arg(n, d=undefined){ const i=process.argv.indexOf(`--${n}`); return i>=0?(process.argv[i+1]??true):d; }
const STORAGE = arg('storage-state', '01-evidence/private/inkstone-auth.json');
const TEXT = arg('text', 'INKSTONE-RE-A1：请只回复 OK。');
const URL_ = arg('url', 'https://discovery.intern-ai.org.cn/chat/');
const PROXY = resolveBrowserProxy(process.env);
mkdirSync('01-evidence/private', {recursive:true});
mkdirSync('01-evidence/sanitized/streams', {recursive:true});

if (!existsSync(STORAGE)) { console.log(JSON.stringify({error:'storage-state not found'})); process.exit(2); }

const raw = { sent: null, responses: [] };
const browser = await chromium.launch({ headless: true, ...launchProxy(PROXY) });
const context = await browser.newContext({ storageState: STORAGE });

context.on('request', async (rq) => {
  if (rq.method()==='POST' && rq.url().includes('/api/')) {
    const pd = rq.postData() || '';
    raw[`req_${new URL(rq.url()).pathname}`] = { url: rq.url(), method: rq.method(), postData: pd,
      contentType: rq.headers()['content-type'] || '' };
  }
});

const page = await context.pages()[0] ?? await context.newPage();
let navErr=null;
try { await page.goto(URL_, { waitUntil:'networkidle', timeout:60000 }); } catch(e){ navErr=String(e.message).split('\n')[0]; }
await page.waitForTimeout(4000);

// 找输入框
const cand = page.locator('textarea, [contenteditable="true"], input[type="text"]');
const n = await cand.count();
let used = null;
for (let i=0;i<n;i++){
  const el = cand.nth(i);
  const ph = (await el.getAttribute('placeholder'))||'';
  const vis = await el.isVisible().catch(()=>false);
  if (vis) { used = {i, ph}; break; }
}
if (!used) { const s={stage:'find-input', navErr, candidates:n, error:'no visible input'}; writeFileSync('01-evidence/sanitized/a1-errors.json', JSON.stringify(s,null,2)); console.log(JSON.stringify(s,null,2)); await browser.close(); process.exit(3); }

// 监听发送相关响应
const apiResp = [];
context.on('response', async (res) => {
  const u = res.url();
  if (u.includes('/api/orbit') || u.includes('/api/spacebe')) {
    apiResp.push({ url: u, status: res.status(), ct: res.headers()['content-type']||'' });
  }
});

const inp = cand.nth(used.i);
await inp.click();
await inp.fill(TEXT);
await page.waitForTimeout(500);
// 提交：优先回车
let submitVia='enter';
await inp.press('Enter');
await page.waitForTimeout(1500);

// 等待可能的 POST（chat/new 或 chat 发送）
let sendReq=null, sendResp=null;
try {
  const r = await page.waitForResponse(res => res.request().method()==='POST' && res.url().includes('/api/orbit'),
    { timeout: 45000 });
  sendResp = r;
} catch(e) {
  // 尝试按钮
  const btn = page.locator('button', { hasText: /开始探索|发送|提交|Send|Submit/ });
  if (await btn.count()) { submitVia='button'; await btn.first().click().catch(()=>{}); }
  try { const r = await page.waitForResponse(res => res.request().method()==='POST' && res.url().includes('/api/orbit'), { timeout: 45000 }); sendResp=r; } catch(e2){}
}

await page.waitForTimeout(8000);

let respBody=null, respCt=null, respStatus=null;
if (sendResp) {
  respStatus = sendResp.status();
  respCt = sendResp.headers()['content-type']||'';
  try { respBody = await sendResp.text(); } catch(e) { respBody = `[body read failed: ${e.message}]`; }
}

const outDir='01-evidence/private';
writeFileSync(`${outDir}/a1-raw.json`, JSON.stringify({ text:TEXT, sent:raw, apiResp, respStatus, respCt, respBody }, null, 2));

// 脱敏摘要
function keysOf(body){ try { const j=JSON.parse(body); return Array.isArray(j)?`[array len ${j.length}]`:Object.keys(j); } catch { return null; } }
const sendUrl = sendResp ? sendResp.url() : null;
const summary = {
  scenario:'A1', navErr, input:{placeholder:used.ph, candidates:n}, submitVia,
  apiResponses: apiResp,
  send: sendResp ? {
    url: sendUrl, method:'POST', status: respStatus, contentType: respCt,
    streaming: /text\/event-stream|application\/x-ndjson|x-ndjson|chunked/i.test(String(respCt)),
    bodyBytes: respBody? respBody.length : null,
    bodyTopKeys: respBody? keysOf(respBody) : null,
    bodyHeadSanitized: respBody? respBody.slice(0, 400).replace(/[A-Za-z0-9_-]{24,}/g,'<ID>') : null
  } : null,
};
writeFileSync('01-evidence/sanitized/a1-summary.json', JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
await browser.close();
