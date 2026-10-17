// A3：新建另一个会话，发送与 A1 相同的文本，比较会话级/消息级字段。
// A4：刷新页面并打开刚才的会话，观察历史恢复。
// 原始件写 private；脱敏摘要写 sanitized。stdout 只打印脱敏摘要。
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { loadPatchright } from './browser-lib.mjs';
const _pw = await loadPatchright();
const chromium = _pw.chromium ?? _pw.default?.chromium;
function arg(n,d=undefined){const i=process.argv.indexOf(`--${n}`);return i>=0?(process.argv[i+1]??true):d;}
const STORAGE=arg('storage-state','01-evidence/private/inkstone-auth.json');
const A1TEXT=arg('text','INKSTONE-RE-A1：请只回复 OK。');
const OPEN_ID=arg('open-id', null);
const PROXY=resolveBrowserProxy(process.env);
const HOME='https://discovery.intern-ai.org.cn/chat/';
mkdirSync('01-evidence/private',{recursive:true});
mkdirSync('01-evidence/sanitized',{recursive:true});
if(!existsSync(STORAGE)){console.log(JSON.stringify({error:'no storage'}));process.exit(2);}

const raw={reqs:[],resps:[],streams:{}};
const browser=await chromium.launch({headless:true,proxy:{server:PROXY}});
const context=await browser.newContext({storageState:STORAGE});
context.on('request',rq=>{ if(rq.method()==='POST'&&rq.url().includes('/api/')) raw.reqs.push({path:new URL(rq.url()).pathname,ct:rq.headers()['content-type']||'',postData:rq.postData()||''}); });
const sse=[];
context.on('response',res=>{ const u=res.url(),ct=res.headers()['content-type']||''; raw.resps.push({path:(()=>{try{return new URL(u).pathname}catch{return u}})(),status:res.status(),ct});
  if(/text\/event-stream/.test(ct)) sse.push((async()=>{try{const b=await res.body();raw.streams[new URL(u).pathname+'_'+Date.now()]=Buffer.from(b).toString('utf8');}catch(e){}})()); });
const page=await context.pages()[0]??await context.newPage();
await page.goto(HOME,{waitUntil:'networkidle',timeout:60000}); await page.waitForTimeout(4000);

async function input(){const c=page.locator('textarea,[contenteditable="true"],input[type="text"]');for(let i=await c.count()-1;i>=0;i--){const el=c.nth(i);if(await el.isVisible().catch(()=>false))return el;}return null;}
async function send(t){const el=await input();if(!el)return false;await el.click();await el.fill(t);await page.waitForTimeout(400);await el.press('Enter');await page.waitForTimeout(1200);
  try{await page.waitForResponse(r=>r.request().method()==='POST'&&r.url().includes('/api/orbit/v1/chat'),{timeout:40000})}catch{const b=page.locator('button',{hasText:/开始探索|发送|提交|Send|Submit/});if(await b.count())await b.first().click().catch(()=>{});}
  await page.waitForTimeout(1000);return true;}

// ---- A3 ----
await send(A1TEXT);
await page.waitForResponse(r=>/\/chat\/\d+\/title/.test(r.url()),{timeout:60000}).catch(()=>{});
await page.waitForTimeout(6000);
await Promise.allSettled(sse);
const a3cid=(raw.resps.map(r=>{const m=r.path.match(/\/chat\/(\d+)(\/|$)/);return m?m[1]:null}).find(Boolean))||null;
const r3=raw.resps.length, q3=raw.reqs.filter(x=>x.path==='/api/orbit/v1/chat').map(x=>x.postData);

// ---- A4：刷新并打开会话 ----
sse.length=0;
await page.reload({waitUntil:'networkidle',timeout:60000}); await page.waitForTimeout(4000);
let opened=null;
try{
  // 优先点击包含 chatid 的链接或历史项
  const link=page.locator('a[href*="chatid="]');
  if(await link.count()){ await link.first().click(); opened='link'; }
  else {
    const item=page.locator('text=INKSTONE-RE-A1').first();
    if(await item.count()){ await item.click(); opened='history-text'; }
  }
}catch(e){ opened='err:'+String(e.message).slice(0,60); }
await page.waitForTimeout(8000);
await page.waitForResponse(r=>/\/chat\/\d+\/detail/.test(r.url()),{timeout:20000}).catch(()=>{});
await Promise.allSettled(sse);
await page.waitForTimeout(2000);

writeFileSync('01-evidence/private/a3a4-raw.json',JSON.stringify(raw,null,2));
function sseShape(t){const evs=t.split('\n\n').filter(Boolean);const types={};for(const e of evs){try{const d=e.split('\n').find(l=>l.startsWith('data:'));const j=JSON.parse(d.slice(5).trim());types[j.event]=(types[j.event]||0)+1;}catch{}}return{eventCount:evs.length,types};}
const summary={
 A3:{ newConversationId:a3cid, chatPostBodies_areA1Text: q3.map(p=>p.includes('INKSTONE-RE-A1')),
      chatPostBodyKeys: q3.map(p=>{try{return Object.keys(JSON.parse(p))}catch{return null}}),
      sseStreams: Object.entries(raw.streams).map(([k,v])=>({k, ...sseShape(v)})) },
 A4:{ openedVia:opened,
      detailRequests: raw.resps.filter(r=>/\/chat\/\d+\/detail|\/messages|\/chat\/list/.test(r.path)).map(r=>({path:r.path,status:r.status})),
      sseStreams: Object.entries(raw.streams).map(([k,v])=>({k,...sseShape(v)})) },
 responsesCount: raw.resps.length };
writeFileSync('01-evidence/sanitized/a3a4-summary.json',JSON.stringify(summary,null,2));
console.log(JSON.stringify(summary,null,2));
await browser.close();
