// A0 未登录初始化抓取：用 patchright(Chromium) 打开目标聊天页，记录初始化请求与资源。
// 只做页面加载观察；不注入 Hook、不发送业务消息、不需要登录。
// 用法: node src/a0_capture.mjs [url]
import { writeFileSync, mkdirSync } from 'node:fs';
import { launchProxy, loadPatchright, resolveBrowserProxy } from './browser-lib.mjs';
const _pw = await loadPatchright();
const chromium = _pw.chromium ?? _pw.default?.chromium;

const URL_ = process.argv[2] || 'https://discovery.intern-ai.org.cn/chat/';
const PROXY = resolveBrowserProxy(process.env);
const OUT = '01-evidence/sanitized';
mkdirSync(OUT, { recursive: true });
mkdirSync('01-evidence/sanitized/streams', { recursive: true });

const records = [];
const browser = await chromium.launch({ headless: true, ...launchProxy(PROXY) });
const context = await browser.newContext();
const page = await context.newPage();

page.on('request', (req) => {
  records.push({ kind: 'request', ts: Date.now(), method: req.method(), url: req.url(),
    rtype: req.resourceType(), hasPostData: !!req.postData() });
});
page.on('response', (res) => {
  records.push({ kind: 'response', ts: Date.now(), status: res.status(),
    contentType: (res.headers()['content-type'] || ''), url: res.url() });
});

let navErr = null;
try {
  await page.goto(URL_, { waitUntil: 'networkidle', timeout: 60000 });
} catch (e) { navErr = String(e.message).split('\n')[0]; }

// 再给动态资源一点时间
await page.waitForTimeout(5000);

const title = await page.title().catch(() => null);
const html = await page.content().catch(() => '');
writeFileSync(`${OUT}/a0-page.html`, html);
writeFileSync(`${OUT}/a0-network.json`, JSON.stringify({ url: URL_, title, navErr, records }, null, 2));

// 汇总
const reqs = records.filter(r => r.kind === 'request');
const byType = {};
for (const r of reqs) byType[r.rtype] = (byType[r.rtype] || 0) + 1;
const hostCount = {};
for (const r of reqs) { try { hostCount[new URL(r.url).host] = (hostCount[new URL(r.url).host] || 0) + 1; } catch {} }

console.log(JSON.stringify({
  ok: !navErr, navErr, title,
  totalRequests: reqs.length,
  byResourceType: byType,
  byHost: hostCount,
  scriptUrls: reqs.filter(r => r.rtype === 'script').map(r => r.url).slice(0, 50),
}, null, 2));

await browser.close();
