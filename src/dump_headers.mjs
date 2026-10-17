// 诊断：抓取浏览器对 /api/orbit 的 POST 请求头（只列名称；值脱敏/仅长度），用于对齐最小客户端。
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
const _req = createRequire('/home/ma-user/.dsh/profiles/web/package.json');
const _pw = await import(_req.resolve('patchright'));
const chromium = _pw.chromium ?? _pw.default?.chromium;
function arg(n,d=undefined){const i=process.argv.indexOf(`--${n}`);return i>=0?(process.argv[i+1]??true):d;}
const STORAGE=arg('storage-state','01-evidence/private/inkstone-auth.json');
const PROXY=process.env.HTTPS_PROXY||process.env.https_proxy||'http://127.0.0.1:9999';
const SENSITIVE=/cookie|authorization|token|jwt|auth|x-s|secret|sign|nonce|timestamp|x-csrf|csrf/i;
const SAFE=new Set(['content-type','accept','origin','referer','user-agent','accept-language','sec-ch-ua','sec-fetch-mode','x-requested-with','app-id','x-app-id','tenant-id','x-tenant-id']);
const captured=[];
const browser=await chromium.launch({headless:true,proxy:{server:PROXY}});
const context=await browser.newContext({storageState:STORAGE});
context.on('request',rq=>{
  if(rq.method()==='POST'&&rq.url().includes('/api/orbit')){
    const h=rq.headers(); const out={path:new URL(rq.url()).pathname, headers:{}};
    for(const [k,v] of Object.entries(h)){
      if(SENSITIVE.test(k)) out.headers[k]=`<redacted len=${String(v).length}>`;
      else if(SAFE.has(k)) out.headers[k]=String(v).slice(0,120);
      else out.headers[k]=`<${String(v).length} chars>`;
    }
    captured.push(out);
  }
});
const page=await context.pages()[0]??await context.newPage();
await page.goto('https://discovery.intern-ai.org.cn/chat/',{waitUntil:'networkidle',timeout:60000});
await page.waitForTimeout(4000);
const el=page.locator('textarea,[contenteditable="true"],input[type="text"]').first();
await el.click(); await el.fill('INKSTONE-RE-HDR：请只回复 OK。'); await page.waitForTimeout(400); await el.press('Enter');
await page.waitForTimeout(20000);
writeFileSync('01-evidence/sanitized/orbit-request-headers.json', JSON.stringify(captured,null,2));
console.log(JSON.stringify(captured,null,2));
await browser.close();
