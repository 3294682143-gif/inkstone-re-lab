// 通用采集器：用 patchright(Chromium) 打开目标页并记录网络，可加载本地 storageState 复用登录态。
// 登录态的加载入口就在这里：newContext({ storageState })。
//
// 用法示例：
//   # A0 未登录
//   node src/collect.mjs --scenario A0
//   # 复用你导出的登录态（文件留在 01-evidence/private/，本工具只读路径，不打印内容）
//   node src/collect.mjs --scenario A1 --storage-state 01-evidence/private/storage-state.json
//   # 复用持久化用户目录（跨次运行保留登录）
//   node src/collect.mjs --scenario A4 --user-data-dir 01-evidence/private/browser-data
//
// 约定：
//   --storage-state <path>  Playwright/patchright storageState JSON（cookies + origins/localStorage）
//   --user-data-dir <path>  持久化用户目录；提供时用 launchPersistentContext（登录态落盘复用）
//   --scenario <A0..A6>     本 CSV/文件名使用的场景号
//   --url <url>             默认 https://discovery.intern-ai.org.cn/chat/
//   --headful               需要 DISPLAY 时才可用；无显示环境请勿使用
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { launchProxy, loadPatchright, resolveBrowserProxy } from './browser-lib.mjs';

const _pw = await loadPatchright();
const chromium = _pw.chromium ?? _pw.default?.chromium;

function arg(name, def = undefined) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? true) : def;
}
const URL_ = arg('url', 'https://discovery.intern-ai.org.cn/chat/');
const SCEN = arg('scenario', 'A0');
const STORAGE = arg('storage-state', null);      // ← 登录态文件路径（可空）
const USERDATA = arg('user-data-dir', null);     // ← 或持久化用户目录
const HEADFUL = !!arg('headful', false);
const PROXY = resolveBrowserProxy(process.env);

const OUT = '01-evidence/sanitized';
mkdirSync(OUT, { recursive: true });

const records = [];
const launchOpts = { headless: !HEADFUL, ...launchProxy(PROXY) };

let browser, context;
if (USERDATA) {
  context = await chromium.launchPersistentContext(USERDATA, launchOpts);
  context.on('page', () => {});
} else {
  browser = await chromium.launch(launchOpts);
  // ★ storageState 加载入口 ★
  const ctxOpts = STORAGE && existsSync(STORAGE) ? { storageState: STORAGE } : {};
  if (STORAGE && !existsSync(STORAGE)) console.error(`[warn] storage-state 不存在: ${STORAGE}（按未登录处理）`);
  context = await browser.newContext(ctxOpts);
}

context.on('request', (req) => records.push({ kind: 'request', ts: Date.now(),
  method: req.method(), url: req.url(), rtype: req.resourceType(), hasPostData: !!req.postData() }));
context.on('response', (res) => records.push({ kind: 'response', ts: Date.now(),
  status: res.status(), contentType: res.headers()['content-type'] || '', url: res.url() }));

const page = context.pages()[0] ?? await context.newPage();
let navErr = null;
try { await page.goto(URL_, { waitUntil: 'networkidle', timeout: 60000 }); }
catch (e) { navErr = String(e.message).split('\n')[0]; }
await page.waitForTimeout(5000);

const title = await page.title().catch(() => null);
writeFileSync(`${OUT}/${SCEN.toLowerCase()}-page.html`, await page.content().catch(() => ''));
writeFileSync(`${OUT}/${SCEN.toLowerCase()}-network.json`,
  JSON.stringify({ url: URL_, scenario: SCEN, storageStateLoaded: !!(STORAGE && existsSync(STORAGE)),
    title, navErr, records }, null, 2));

const reqs = records.filter(r => r.kind === 'request');
const byHost = {};
for (const r of reqs) { try { byHost[new URL(r.url).host] = (byHost[new URL(r.url).host] || 0) + 1; } catch {} }
console.log(JSON.stringify({ scenario: SCEN, storageStateLoaded: !!(STORAGE && existsSync(STORAGE)),
  ok: !navErr, navErr, title, totalRequests: reqs.length, byHost }, null, 2));

if (browser) await browser.close();
else await context.close();
