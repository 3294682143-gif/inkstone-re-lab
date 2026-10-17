// 登录态验证：加载 storageState，打开目标页，用「需鉴权接口的状态码」判定是否真的登录。
// 只输出脱敏摘要（状态码/端点/页面标记），不打印任何凭证内容。
// 用法: node src/verify_login.mjs --storage-state 01-evidence/private/inkstone-auth.json
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { launchProxy, loadPatchright, resolveBrowserProxy } from './browser-lib.mjs';

const _pw = await loadPatchright();
const chromium = _pw.chromium ?? _pw.default?.chromium;

function arg(n, d=undefined){ const i=process.argv.indexOf(`--${n}`); return i>=0?(process.argv[i+1]??true):d; }
const STORAGE = arg('storage-state', '01-evidence/private/inkstone-auth.json');
const URL_ = arg('url', 'https://discovery.intern-ai.org.cn/chat/');
const PROXY = resolveBrowserProxy(process.env);
const OUT = '01-evidence/sanitized'; mkdirSync(OUT, {recursive:true});

if (!existsSync(STORAGE)) { console.log(JSON.stringify({error:'storage-state not found', STORAGE})); process.exit(2); }

const api = {};   // url -> status
const browser = await chromium.launch({ headless: true, ...launchProxy(PROXY) });
const context = await browser.newContext({ storageState: STORAGE });   // ★ 同一 BrowserContext 复用登录态
context.on('response', (res) => {
  const u = res.url();
  if (u.includes('/api/')) { try { const p = new URL(u); api[p.pathname + (p.search?'?'+p.searchParams.toString().slice(0,0):'')] = res.status(); } catch { api[u]=res.status(); } }
});
const page = await context.pages()[0] ?? await context.newPage();
let navErr=null;
try { await page.goto(URL_, {waitUntil:'networkidle', timeout:60000}); } catch(e){ navErr=String(e.message).split('\n')[0]; }
await page.waitForTimeout(6000);

const title = await page.title().catch(()=>null);
// 页面是否显示“未登录/登录”标记（只取布尔，不落文本）
const bodyText = await page.evaluate(() => document.body ? document.body.innerText.slice(0, 20000) : '').catch(()=> '');
const markers = {
  hasLoginWord: /登录|登入|sign\s*in|log\s*in/i.test(bodyText),
  hasLogoutWord: /退出|登出|logout|sign\s*out/i.test(bodyText),
  hasUserInfoWord: /个人中心|我的|账号|用户中心|profile/i.test(bodyText),
};
const inputCount = await page.locator('textarea, input[type="text"], [contenteditable="true"]').count().catch(()=>0);

// 判定：需鉴权接口是否不再 401
const authEndpoints = Object.entries(api).filter(([k]) => k.includes('/api/'));
const still401 = authEndpoints.filter(([,v]) => v===401).map(([k])=>k);
const ok200 = authEndpoints.filter(([,v]) => v>=200 && v<300).map(([k])=>k);

const loggedInGuess = still401.length===0 && ok200.length>0;

const summary = { storageState: STORAGE, title, navErr,
  apiStatuses: api, still401, ok200, loggedInGuess,
  dom: { hasLoginWord: markers.hasLoginWord, hasLogoutWord: markers.hasLogoutWord,
         hasUserInfoWord: markers.hasUserInfoWord, inputCount } };
writeFileSync(`${OUT}/login-check.json`, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
await browser.close();
