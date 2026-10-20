// tools/mock-gateway.mjs
// 本地离线 mock gateway + 逆向协议演示页。
// - `/`      逆向出的“完整页面”：可交互聊天（用已确认的桌面协议，流式 SSE）
// - `/debug` 端点调试页（逐个调用）
// - `/health`
// - `/api/orbit/v1/*` 已确认协议子集（合成数据）
// 全部离线、无凭据、不启动 Electron/Windows。
//   node tools/mock-gateway.mjs [--port 8787] [--host 0.0.0.0]
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { renderReportHtml } from './re-findings-report.mjs';

// 网页协议（A5/A6 契约）的合成模型表：真实接口只返回 name/tags/icon
const WEB_MODELS = [
  { name: 'Default', tags: [], icon: '' },
  { name: '书生-Agents-A1', tags: ['多模态'], icon: '' },
  { name: '书生-S2', tags: ['多模态'], icon: '' },
  { name: '书生-Atria-Dawn-Preview', tags: ['大语言模型'], icon: '' },
  { name: 'Qwen3.7-Plus', tags: [], icon: '' },
  { name: 'Qwen3.8-Flash', tags: [], icon: '' },
  { name: 'DeepSeek-V4-Flash', tags: [], icon: '' },
  { name: 'Kimi-K2.7-Code', tags: [], icon: '' },
];
const SCp_TAGS = { list: [
  { id: 1, name: '生命科学', name_en: 'Life Sciences', icon: '', type: 1 },
  { id: 2, name: '地球科学', name_en: 'Earth Sciences', icon: '', type: 1 },
  { id: 3, name: '物质科学', name_en: 'Materials Science', icon: '', type: 1 },
  { id: 4, name: '神经科学', name_en: 'Neuroscience', icon: '', type: 1 },
  { id: 5, name: '数学物理', name_en: 'Math & Physics', icon: '', type: 1 },
  { id: 6, name: '通用', name_en: 'General', icon: '', type: 1 },
] };
const DATASET_CATEGORIES = { list: [
  { id: 1, name: '生命科学', icon_url: '', sort: 0, background_color: '#E4EEFF' },
  { id: 2, name: '地球科学', icon_url: '', sort: 1, background_color: '#E6F7EE' },
  { id: 3, name: '物质科学', icon_url: '', sort: 2, background_color: '#FFF4E6' },
  { id: 4, name: '神经科学', icon_url: '', sort: 3, background_color: '#F3E8FF' },
  { id: 5, name: '空间科学', icon_url: '', sort: 4, background_color: '#E8F4FF' },
  { id: 6, name: '空气动力学', icon_url: '', sort: 5, background_color: '#FFECEC' },
], total: 6 };
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

const SCP_ITEMS = [
  { id: 'scp1', name: '蛋白结构预测', tag: '生命科学', type: 'SCP', downloads: 1280 },
  { id: 'scp2', name: '气候模式降尺度', tag: '地球科学', type: 'SCP', downloads: 860 },
  { id: 'scp3', name: '晶体结构筛选', tag: '物质科学', type: 'Skills', downloads: 2140 },
  { id: 'scp4', name: '单细胞聚类', tag: '生命科学', type: 'Skills', downloads: 530 },
  { id: 'scp5', name: '光子能量计算', tag: '物理科学', type: 'SCP', downloads: 310 },
];

// 有状态存储：新建/启停/创建 Key/申请 会真正改变后续查询结果
const store = {
  spaces: [
    { id: '3914', name: 'COCO 与 YOLOv8 复现', field: '通用', description: '目标检测基线复现与方法对比', members: 3, files: 27, updated_at: '2026-10-18T09:12:00Z' },
    { id: '3915', name: '离线回归项目', field: '通用', description: '桌面/网页协议回归验证用', members: 2, files: 9, updated_at: '2026-10-17T08:00:00Z' },
  ],
  files: {
    '3914': [
      { id: 'f1', name: 'train.py', size: 4210, type: 'file' },
      { id: 'f2', name: 'coco.yaml', size: 1204, type: 'file' },
      { id: 'f3', name: 'runs/', size: 0, type: 'dir' },
    ],
    '3915': [
      { id: 'f4', name: 'regress.mjs', size: 9800, type: 'file' },
    ],
  },
  machines: [
    { id: 'dm-001', name: 'A100 开发机', status: 'running', gpu: 'A100 80G', quota: '1/1' },
    { id: 'dm-002', name: 'CPU 调试机', status: 'stopped', gpu: '-', quota: '0/1' },
  ],
  keys: [
    { id: 'key_1', name: '默认 Key', masked: 'sk-****3f2a', created_at: '2026-09-01', status: 'active' },
    { id: 'key_2', name: 'CI Key', masked: 'sk-****88cd', created_at: '2026-10-02', status: 'active' },
  ],
  applies: [
    { id: 'dw1', title: '蛋白表达湿实验', status: 'reviewing', submitted_at: '2026-10-12', owner: '禾青' },
  ],
  downloads: [],
};
let seq = 100;

const CAPABILITIES = (marker) => ({
  protocol_version: '2.0',
  models: [{
    id: 'synthetic-model-a', canonical_id: 'synthetic-model-a', display_name: 'Synthetic Model A',
    context_window: 100000, max_output_tokens: 8000,
    supports_thinking: true, supports_tools: true, supports_attachments: false,
    answer_transport: 'strict_eof', tags: [marker], pro: false,
  }],
  limits: {
    max_request_bytes: 1000000, max_messages: 100, max_tools: 50, max_tool_name_bytes: 64,
    max_tool_description_bytes: 4096, max_tool_input_schema_bytes: 262144, max_start_prompt_bytes: 100000,
    max_checkpoint_bytes: 500000, max_prompt_bytes: 500000, max_thinking_bytes: 400000,
    max_answer_bytes: 400000, max_agent_events: 1000, max_agent_event_bytes: 100000, max_agent_events_bytes: 1000000,
  },
});

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => { const s = Buffer.concat(chunks).toString('utf8'); try { resolve(s ? JSON.parse(s) : {}); } catch { resolve({}); } });
  });
}
const envelope = (data) => JSON.stringify({ msg: 'ok', trace_id: 'synthetic-trace', code: 0, data });
const gsse = (events) => events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');

const DEBUG_HTML = `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>mock gateway · debug</title>
<style>body{font-family:system-ui,Segoe UI,Arial;margin:24px;max-width:900px}pre{background:#f4f4f4;padding:10px;overflow:auto;max-height:360px}button{margin:4px 6px 4px 0;padding:6px 10px}.tag{color:#b00}</style></head>
<body><h1>mock gateway · 端点调试</h1><p>合成数据；离线；无凭据。<span class="tag">SYNTHETIC</span> · <a href="ui">返回聊天页</a></p>
<div>
<button data-m="POST" data-p="chat/new" data-b='{"scenario":2,"type":0,"provider":0,"agent":"local_agent"}'>POST /chat/new</button>
<button data-m="GET" data-p="local-agent/models">GET /local-agent/models</button>
<button data-m="POST" data-p="local-agent/messages" data-b='{"chat_id":1,"model":"synthetic-model-a","messages":[],"tools":[]}' data-sse="1">POST /local-agent/messages (SSE)</button>
<button data-m="POST" data-p="chat/1/local-turns" data-b='{}'>POST /chat/1/local-turns</button>
<button data-m="POST" data-p="chat/1/local-turns/turn_syn_1/complete" data-b='{}'>POST .../complete</button>
<button data-m="GET" data-p="health">GET /health</button>
</div><pre id="out">(点击按钮)</pre>
<script>
function apiBase(){ let p=location.pathname.replace(/\\/+$/,'').replace(/\\/(ui|debug)$/,''); return p + '/api/orbit/v1'; }
const out=document.getElementById('out');
document.querySelectorAll('button').forEach(b=>b.addEventListener('click',async()=>{
  const url=apiBase()+'/'+b.dataset.p;
  try{const r=await fetch(url,{method:b.dataset.m,headers:{'content-type':'application/json','accept':b.dataset.sse?'text/event-stream':'application/json'},body:b.dataset.b??undefined});
    out.textContent='HTTP '+r.status+' '+r.headers.get('content-type')+'\\n\\n'+(await r.text());
  }catch(e){out.textContent='ERR '+e.message;}
}));
</script></body></html>`;

// 逆向协议演示页：新建会话 → 发送 → SSE 流式渲染（thinking/content/tool/usage）→ 本地轮次同步
const CHAT_HTML = `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>Intern InkStone · 逆向协议演示</title>
<style>
:root{--bg:#f7f8fa;--panel:#ffffff;--line:#e3e6ec;--fg:#1c1c1e;--muted:#8a8f99;--acc:#2f6fed;--think:#9aa3a8}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.6 system-ui,Segoe UI,Arial}
header{padding:12px 18px;border-bottom:1px solid var(--line);display:flex;gap:10px;align-items:center;flex-wrap:wrap}
header b{font-size:15px}.tag{background:#fff4e6;color:#b26a00;border:1px solid #f0d48a;border-radius:10px;padding:1px 8px;font-size:12px}
.app{display:grid;grid-template-columns:210px 1fr;min-height:100vh}
.side{background:#fff;border-right:1px solid var(--line);padding:14px 12px;display:flex;flex-direction:column;gap:8px}
.brand{font-weight:700;font-size:15px;padding:4px 6px 10px;display:flex;gap:8px;align-items:center}
.brand .dot{color:#2f6fed}
.newchat{display:flex;gap:8px;align-items:center;padding:9px 12px;border:1px solid var(--line);border-radius:10px;background:#fff;font-size:13px;cursor:pointer}
.nav{display:flex;flex-direction:column;gap:2px;margin-top:10px}
.nav a{padding:8px 10px;border-radius:8px;font-size:13px;color:#3a3f47;cursor:pointer;text-decoration:none}
.nav a:hover{background:#f3f6fb}
.main{display:flex;flex-direction:column}
.hero{text-align:center;padding:36px 16px 8px}
.hero h1{font-family:"Songti SC","SimSun",serif;font-size:34px;letter-spacing:2px;margin:6px 0 8px}
.hero p{color:#8a8f99;font-size:13px;margin:0}
.foot{text-align:center;color:#a2a7b0;font-size:11px;padding:14px 0 18px;margin-top:auto}
.foot .sep{margin:0 8px}
.wrap{max-width:920px;margin:0 auto;padding:16px;width:100%}
.dev{margin:4px 0 8px;font-size:12px;color:#8a8f99}
.view{padding:4px 0}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px;margin-top:10px}
.card{border:1px solid var(--line);border-radius:12px;padding:12px;background:#fff}
.card b{display:block;margin-bottom:4px;font-size:14px}
.card span{color:#8a8f99;font-size:12px}
.viewTitle{font-size:15px;font-weight:600;margin:6px 0 2px}
.viewHint{color:#8a8f99;font-size:12px}
.nav a.active{background:#eef3ff;color:#2f6fed}
.modes{display:inline-flex;gap:6px;margin-left:8px}
.pill{border:1px solid var(--line);background:#fff;color:#4a5058;border-radius:999px;padding:5px 12px;font-size:12px;cursor:pointer}
.pill.on{background:#eef3ff;border-color:#bcd2ff;color:#2f6fed;font-weight:600}
.dev summary{cursor:pointer}
.row{display:flex;gap:8px;align-items:center;margin:8px 0;flex-wrap:wrap}
input,select,button{background:var(--panel);color:var(--fg);border:1px solid var(--line);border-radius:8px;padding:8px 10px;font:inherit}
input{flex:1;min-width:220px}button{cursor:pointer}button.primary{background:var(--acc);border-color:var(--acc);color:#fff}
button:disabled{opacity:.5;cursor:not-allowed}
.chat{border:1px solid var(--line);border-radius:12px;padding:12px;min-height:260px;background:var(--panel)}
.msg{margin:10px 0;padding:10px 12px;border-radius:10px;white-space:pre-wrap;word-break:break-word}
.user{background:#eaf1ff;border:1px solid #cfe0ff}
.assistant{background:#f4f5f7;border:1px solid var(--line)}
.think{color:var(--think);font-style:italic;border-left:2px solid #3a4152;padding-left:8px;margin:6px 0;white-space:pre-wrap}
.tool{font-family:ui-monospace,Consolas,monospace;font-size:12.5px;color:#274b7a;background:#f4f7fb;border:1px dashed #c8d6ea;border-radius:8px;padding:6px 8px;margin:6px 0}
.meta{color:var(--muted);font-size:12.5px;margin-top:6px}
.err{color:#ff9a9a}
.ids{color:var(--muted);font-size:12px}
</style></head>
<body>
<header>
  <b>Intern InkStone · 逆向协议演示</b>
  <span class="tag">SYNTHETIC</span>
  <span class="ids" id="ids">chat_id: —</span>
  <span style="margin-left:auto"></span>
  <a href="report" style="color:var(--acc)">成果总览</a>
  <a href="debug" style="color:var(--acc)">端点调试</a>
</header>
<div class="app">
<aside class="side">
  <div class="brand"><span class="dot">◍</span> 书生·端砚</div>
  <button class="newchat" data-route="/chat">＋ 新建对话</button>
  <nav class="nav">
    <a data-route="/paper">▤ 论文工具</a>
    <a data-route="/repo">▥ 课题空间</a>
    <a data-route="/app">◈ 科研应用</a>
    <a data-route="/scp">▦ 科学工具</a>
    <a data-route="/dataset">▤ 科学数据</a>
    <a data-route="/compute">▥ 科学计算</a>
    <a data-route="/token-plan/home">▦ 科研模型</a>
  </nav>
</aside>
<main class="main">
<div class="hero"><h1>科学发现 探索未来</h1><p>连接科研全流程的智能工作台 · 让每一个洞察都有迹可循</p></div>
<div class="wrap">
<div id="chatPane">
  <div class="row composer">
    <select id="wmodel" style="max-width:220px"></select>
    <input id="model" value="synthetic-model-a" style="max-width:200px;display:none">
    <button id="new">＋ 新建对话</button>
    <button id="stop" disabled>停止</button>
    <span class="modes"><button id="mQuick" class="pill">快速</button><button id="mDeep" class="pill on">深度</button></span>
  </div>
  <details class="dev"><summary>调试 / 协议</summary>
    <div class="row">
      <label>base</label><input id="base">
      <label>协议</label><select id="pmode"><option value="desktop">桌面协议</option><option value="web" selected>网页协议</option></select>
    </div>
  </details>
  <div class="chat" id="chat"><div class="msg assistant">已就绪。点击「新建会话」，然后输入消息发送。协议：<code>/chat/new</code> → <code>/local-agent/messages</code>(SSE, type 事件) → 本地轮次同步。</div></div>
  <div class="row">
    <input id="text" placeholder="输入消息，例如：请只回复 OK" autocomplete="off">
    <button class="primary" id="send">开始探索</button>
  </div>
  <div class="row" id="tagsRow" style="flex-wrap:wrap;gap:6px"></div>
  <div class="meta" id="status"></div>
</div>
</div>
<div id="view" class="view" style="display:none"></div>
<footer class="foot"><span>平台服务协议</span><span class="sep">|</span><span>个人信息保护政策</span><span class="sep">|</span><span>沪ICP备2021009351号-21</span></footer>
</main>
</div>
<script>
const $=(s)=>document.querySelector(s);
function apiBase(){ let p=location.pathname.replace(/\\/+$/,'').replace(/\\/(ui|debug)$/,''); return p+'/api/orbit/v1'; }
$('#base').value = apiBase();
let chatId=null, ac=null;
let thinkMode=true; // true=深度（thinking_mode:true），false=快速
const chat=$('#chat'), status=$('#status');
const setStatus=(s)=>status.textContent=s;
function bubble(cls){const d=document.createElement('div');d.className='msg '+cls;chat.appendChild(d);chat.scrollTop=chat.scrollHeight;return d;}

async function newConv(){
  setStatus('创建会话…');
  const r=await fetch($('#base').value+'/chat/new',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify($('#pmode').value==='web'?{scenario:1}:{scenario:2,type:0,provider:0,agent:'local_agent'})});
  const j=await r.json();
  if(!r.ok||j.code!==0||!j.data?.id){setStatus('创建失败 HTTP '+r.status);return;}
  chatId=j.data.id;$('#ids').textContent='chat_id: '+chatId;setStatus('会话已创建');
}

async function send(){
  if($('#pmode').value==='web'){return webSend();}
  if(chatId==null){await newConv();if(chatId==null)return;}
  const text=$('#text').value.trim();if(!text)return;
  $('#text').value='';
  bubble('user').textContent=text;
  const box=bubble('assistant');
  const think=document.createElement('div');think.className='think';think.style.display='none';box.appendChild(think);
  const content=document.createElement('div');box.appendChild(content);
  const tools={}; const toolWrap=document.createElement('div');box.appendChild(toolWrap);
  const meta=document.createElement('div');meta.className='meta';box.appendChild(meta);
  let usage=null, stopReason=null, err=null;

  ac=new AbortController(); $('#send').disabled=true; $('#stop').disabled=false;
  setStatus('推理中（流式）…');
  try{
    const body={scenario:1,thinking_mode:true,planning_mode:false,model:$('#model').value,query:text,chat_id:chatId,protocol_version:'2.0',inference_kind:'turn',lifecycle_owner:'turn',turn_id:'turn_ui_1',request_id:'req_ui_'+Date.now(),messages:[]};
    const r=await fetch($('#base').value+'/local-agent/messages',{method:'POST',signal:ac.signal,headers:{'content-type':'application/json','accept':'text/event-stream'},body:JSON.stringify(body)});
    if(!r.ok||!(r.headers.get('content-type')||'').includes('text/event-stream')){err='响应不是 SSE（HTTP '+r.status+'，'+(r.headers.get('content-type')||'')+'）';}
    else{
      const reader=r.body.getReader(),dec=new TextDecoder();let buf='';
      for(;;){const {done,value}=await reader.read();if(done)break;buf+=dec.decode(value,{stream:true});
        const parts=buf.split('\\n\\n');buf=parts.pop();
        for(const p of parts){const line=p.split('\\n').find(l=>l.startsWith('data:'));if(!line)continue;let e;try{e=JSON.parse(line.slice(5).trim());}catch{continue;}
          if(e.type==='message_start')meta.textContent='response_id='+e.response_id+' model='+e.model;
          else if(e.type==='thinking_delta'){think.style.display='block';think.textContent+=e.text;}
          else if(e.type==='content_delta'){content.textContent+=e.text;}
          else if(e.type==='tool_use_start'){tools[e.id]={name:e.name,json:''};}
          else if(e.type==='tool_input_delta'){tools[e.id]=(tools[e.id]||{json:''});tools[e.id].json+=e.partial_json;}
          else if(e.type==='tool_use_end'){tools[e.id]=tools[e.id]||{};tools[e.id].input=e.input;}
          else if(e.type==='usage'){usage=e.usage;}
          else if(e.type==='message_end'){stopReason=e.stop_reason;}
          else if(e.type==='error'){err='event error '+e.code+': '+e.message;}
          renderTools();
        }
      }
    }
  }catch(e){ if(e.name!=='AbortError') err='网络/读取错误: '+e.message; else err='已取消（本地）'; }
  finally{
    $('#send').disabled=false; $('#stop').disabled=true; $('#send').textContent='开始探索';
    const parts=[]; if(usage)parts.push('usage in='+usage.input_tokens+' out='+usage.output_tokens); if(stopReason)parts.push('stop_reason='+stopReason);
    if(err){const d=document.createElement('div');d.className='err';d.textContent=err;box.appendChild(d);}
    if(parts.length)meta.textContent+=(meta.textContent?' · ':'')+parts.join(' · ');
    setStatus(err?('结束（有错误/取消）'):('完成'));
    await localTurnSync();
  }
  function renderTools(){toolWrap.innerHTML='';for(const id of Object.keys(tools)){const d=document.createElement('div');d.className='tool';d.textContent='tool '+(tools[id].name||'')+' id='+id+'\\ninput: '+(tools[id].input?JSON.stringify(tools[id].input):tools[id].json||'');toolWrap.appendChild(d);}chat.scrollTop=chat.scrollHeight;}
}

async function localTurnSync(){
  if(chatId==null)return;
  try{
    const s=await (await fetch($('#base').value+'/chat/'+chatId+'/local-turns',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({request_id:'req_ui',turn_id:'turn_ui_1'})})).json();
    const c=await (await fetch($('#base').value+'/chat/'+chatId+'/local-turns/'+s.data.turn_id+'/complete',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({})})).json();
    setStatus('完成 · turn_id='+s.data.turn_id+' status='+c.data.status+' checkpoint_seq='+c.data.checkpoint_seq+' usage.out='+c.data.usage.output_tokens);
  }catch(e){ setStatus('本地轮次同步失败: '+e.message); }
}

// ===== 网页协议客户端（依 A5/A6 契约）=====
let webMid=null;
async function loadWebModels(){
  try{
    const j=await (await fetch($('#base').value+'/models')).json();
    const ms=(j&&j.data&&j.data.models)||[];
    $('#wmodel').innerHTML=ms.map(m=>'<option>'+m.name+'</option>').join('');
    setStatus('已加载 '+ms.length+' 个模型（网页协议）');
  }catch(e){ setStatus('模型列表加载失败: '+e.message); }
}
async function webSend(){
  if(chatId==null){await newConv();if(chatId==null)return;}
  const text=$('#text').value.trim();if(!text)return;
  $('#text').value='';
  bubble('user').textContent=text;
  const box=bubble('assistant');
  const think=document.createElement('div');think.className='think';think.style.display='none';box.appendChild(think);
  const content=document.createElement('div');box.appendChild(content);
  const meta=document.createElement('div');meta.className='meta';box.appendChild(meta);
  const model=$('#wmodel').value||'Default';
  ac=new AbortController(); $('#send').disabled=true; $('#stop').disabled=false; $('#send').textContent='中止对话';
  setStatus('网页协议：推理中（流式）…');
  let err=null, finished=false;
  try{
    const r=await fetch($('#base').value+'/chat',{method:'POST',signal:ac.signal,headers:{'content-type':'application/json','accept':'text/event-stream'},body:JSON.stringify({scenario:1,thinking_mode:thinkMode,planning_mode:false,model,query:text,chat_id:chatId})});
    if(!r.ok||!(r.headers.get('content-type')||'').includes('text/event-stream')){err='响应不是 SSE（HTTP '+r.status+'）';}
    else{
      const reader=r.body.getReader(),dec=new TextDecoder();let buf='';
      for(;;){const {done,value}=await reader.read();if(done)break;buf+=dec.decode(value,{stream:true});
        const parts=buf.split('\\n\\n');buf=parts.pop();
        for(const p of parts){const line=p.split('\\n').find(l=>l.startsWith('data:'));if(!line)continue;let e;try{e=JSON.parse(line.slice(5).trim());}catch{continue;}
          if(e.event==='workflow_started'){ webMid=e.mid; meta.textContent='cid='+e.cid+' mid='+e.mid; }
          else if(e.event==='message'){ if(e.thinking){think.style.display='block';think.textContent+=e.thinking;} if(e.answer)content.textContent+=e.answer; }
          else if(e.event==='message_end'){ if(e.stopped){err='已停止（message_end.stopped=true）';} }
          else if(e.event==='followup'){ meta.textContent+=(meta.textContent?' · ':'')+'followup ×'+((e.followup||[]).length); }
          else if(e.event==='workflow_finished'){ finished=true; }
          chat.scrollTop=chat.scrollHeight;
        }
      }
    }
  }catch(e){ if(e.name!=='AbortError') err='网络/读取错误: '+e.message; else err='已停止（本地 abort）'; }
  finally{
    $('#send').disabled=false; $('#stop').disabled=true; $('#send').textContent='开始探索';
    if(err){const d=document.createElement('div');d.className='err';d.textContent=err;box.appendChild(d);}
    setStatus(finished?'完成 · workflow_finished':(err?('结束：'+err):'结束（未见 workflow_finished）'));
  }
}
async function stopWeb(){
  if(chatId==null||webMid==null){ if(ac)ac.abort(); return; }
  try{
    const j=await (await fetch($('#base').value+'/chat/'+chatId+'/stop',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({message_id:webMid})})).json();
    setStatus('已发送 stop（stopped='+(j&&j.data&&j.data.stopped)+'）');
  }catch(e){ setStatus('stop 失败: '+e.message); }
  if(ac)ac.abort();
}
async function loadTags(){
  try{
    const [a,b]=await Promise.all([
      fetch($('#base').value.replace('/orbit/v1','')+'/scphub/v1/scp/tags').then(r=>r.json()).catch(()=>null),
      fetch($('#base').value.replace('/orbit/v1','')+'/datasets/v1/category/list').then(r=>r.json()).catch(()=>null)
    ]);
    const tags=(a&&a.data&&a.data.list)||[];
    const cats=(b&&b.data&&b.data.list)||[];
    const row=$('#tagsRow');
    row.innerHTML='<span style="font-size:12px;color:#8a8f99;align-self:center">学科：</span>'+
      tags.map(t=>'<button data-t="'+t.name+'" style="border:1px solid #e3e6ec;background:#fff;border-radius:999px;padding:5px 11px;font-size:12px;color:#4a5058">'+t.name+'</button>').join('')+
      '<span style="font-size:12px;color:#8a8f99;align-self:center;margin-left:8px">数据分类：</span>'+
      cats.map(t=>'<button data-d="'+t.name+'" style="border:1px solid #e3e6ec;background:#fff;border-radius:999px;padding:5px 11px;font-size:12px;color:#4a5058">'+t.name+'</button>').join('');
    setStatus('公开接口：学科标签 '+tags.length+' 个、数据分类 '+cats.length+' 个');
  }catch(e){ setStatus('公开接口加载失败: '+e.message); }
}
loadTags();
// 初始：按当前协议模式准备输入区
if ($('#pmode').value === 'web') { $('#wmodel').style.display = ''; $('#model').style.display = 'none'; loadWebModels(); }
$('#pmode').addEventListener('change',()=>{
  const web=$('#pmode').value==='web';
  $('#wmodel').style.display=web?'':'none';
  $('#model').style.display=web?'none':'';
  setStatus(web?'已切到网页协议（/chat SSE）':'已切到桌面协议（/local-agent/messages）');
  if(web) loadWebModels();
});
$('#new').addEventListener('click',()=>newConv());
$('#send').addEventListener('click',()=>send());
function syncModes(){ const q=$('#mQuick'), d=$('#mDeep'); if(!q||!d) return; q.classList.toggle('on', !thinkMode); d.classList.toggle('on', thinkMode);
  $('#send').textContent = (ac ? '中止对话' : '开始探索'); }
if($('#mQuick')) $('#mQuick').addEventListener('click',()=>{ thinkMode=false; syncModes(); setStatus('模式：快速（thinking_mode=false）'); });
if($('#mDeep')) $('#mDeep').addEventListener('click',()=>{ thinkMode=true; syncModes(); setStatus('模式：深度（thinking_mode=true）'); });
syncModes();
$('#stop').addEventListener('click',()=>{ if($('#pmode').value==='web'){ stopWeb(); } else if(ac)ac.abort(); });
$('#text').addEventListener('keydown',(e)=>{ if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send();} });
// 路由：路径取自 bundle 侧栏配置（/chat /paper /repo /app /scp /dataset /compute /token-plan/home）
const VIEWS = {
  '/repo': { title: '课题空间', path: '/repo', api: '/api/spacebe/v1/space/list?page=1&page_size=10', render: function(d){ return (d.list||[]).map(function(x){ return '<div class="card"><b>' + (x.name||('课题 '+x.id)) + '</b><span>' + (x.description||'') + '</span></div>'; }).join(''); } },
  '/scp': { title: '科学工具', path: '/scp', api: '/api/scphub/v1/scp/tags', render: function(d){ return (d.list||[]).map(function(x){ return '<div class="card"><b>' + x.name + '</b><span>' + (x.name_en||'') + '</span></div>'; }).join(''); } },
  '/dataset': { title: '科学数据', path: '/dataset', api: '/api/datasets/v1/dataset/square_list', render: function(d){ return (d.list||[]).map(function(x){ return '<div class="card"><b>' + x.name + '</b><span>' + (x.domain||'') + ' · ' + (x.size||'') + ' · 下载 ' + (x.downloads||0) + '</span></div>'; }).join(''); } },
  '/token-plan/home': { title: '科研模型', path: '/token-plan/home', api: '/api/tokenplan/v1/models', render: function(d){ return (d.list||[]).map(function(m){ return '<div class="card"><b>' + m.name + '</b><span>' + (m.context||'') + ' · ' + (m.pricing||'') + '</span></div>'; }).join(''); } },
  '/paper': { title: '论文工具', path: '/paper', api: '/api/nova/v1/search/hot-papers', render: function(d){ return (d.list||[]).map(function(p){ return '<div class="card"><b>' + p.title + '</b><span>' + (p.venue||'') + ' · ' + (p.year||'') + ' · 引用 ' + (p.citations||0) + '</span></div>'; }).join(''); } },
  '/app': { title: '科研应用', path: '/app', api: '/api/moce/v1/apps/list', render: function(d){ return (d.list||[]).map(function(a){ return '<div class="card"><b>' + a.name + '</b><span>' + (a.domain||'') + ' · ' + (a.summary||'') + '</span></div>'; }).join(''); } },
  '/compute': { title: '科学计算', path: '/compute', api: '/api/ml/v1/dev-machine/list', render: function(d){ return (d.list||[]).map(function(m){ return '<div class="card"><b>' + m.name + '</b><span>' + (m.status||'') + ' · ' + (m.gpu||'') + ' · 配额 ' + (m.quota||'') + '</span></div>'; }).join(''); } },
};
async function showRoute(route, push){
  route = (route || '').replace(/^#/, '') || '/chat';
  if (push !== false) location.hash = route;
  document.querySelectorAll('.nav a').forEach(function(a){ a.classList.toggle('active', a.dataset.route === route); });
  const pane = document.querySelector('#chatPane'), view = document.querySelector('#view');
  if (route === '/chat') { pane.style.display = ''; view.style.display = 'none'; setStatus(''); return; }
  pane.style.display = 'none'; view.style.display = '';
  const v = VIEWS[route];
  if (!v) { view.innerHTML = '<div class="viewTitle">' + route + '</div><div class="viewHint">未知路由</div>'; return; }
  view.innerHTML = '<div class="viewTitle">' + v.title + ' <span class="viewHint">' + v.path + '</span></div><div class="viewHint">数据接口：' + (v.api || '（未逆向到公开接口）') + '</div><div id="viewBody" class="grid"></div>';
  const body = document.querySelector('#viewBody');
  if (!v.api) {
    body.innerHTML = '<div class="card" style="grid-column:1/-1"><b>未实现</b><span>路由已从前端包确认（' + v.path + '），但该模块的接口尚未定位；本轮逆向范围是对话协议。</span></div>';
    return;
  }
  if (route === '/repo') {
    body.addEventListener('click', async function(ev){
      const card = ev.target.closest ? ev.target.closest('.card') : null;
      if (!card) return;
      body.innerHTML = '<div class="card">加载课题详情…</div>';
      try {
        const [r, fr] = await Promise.all([
          fetch('/api/spacebe/v1/space/details'),
          fetch('/api/spacebe/v1/space/assets/files'),
        ]);
        const j = await r.json();
        const fj = await fr.json();
        const d = (j && j.data) || {};
        const files = (fj && fj.data && fj.data.list) || [];
        body.innerHTML = '<div class="card" style="grid-column:1/-1"><b>' + (d.name || '') + '</b>' +
          '<span>成员 ' + (d.members || 0) + ' · 文件 ' + (d.files || files.length) + ' · 更新 ' + (d.updated_at || '') + '</span>' +
          '<div style="margin-top:6px;font-size:13px">' + (d.description || '') + '</div>' +
          '<div style="margin-top:8px;font-size:12px;color:#8a8f99">文件（' + files.length + '）：' + files.map(function(x){ return x.name; }).join(' · ') + '</div>' +
          '<div style="margin-top:10px"><button id="repoBack">← 返回课题列表</button></div></div>';
        const back = document.querySelector('#repoBack');
        if (back) back.addEventListener('click', function(){ showRoute('/repo'); });
      } catch (e) {
        body.innerHTML = '<div class="card"><b>详情加载失败</b><span>' + e.message + '</span></div>';
      }
    });
  }
  if (route === '/app') {
    body.dataset.skip = '1';
    const loadApps = async function(){
      body.innerHTML = '<div class="card">加载中…</div>';
      try {
        const [a, st] = await Promise.all([
          fetch('/api/moce/v1/apps/list').then(function(r){ return r.json(); }),
          fetch('/api/moce/v1/dry_wet_loop/apply/status/list').then(function(r){ return r.json(); }),
        ]);
        const apps = (a && a.data && a.data.list) || [];
        const reqs = (st && st.data && st.data.list) || [];
        body.innerHTML = '<div class="card" style="grid-column:1/-1"><b>FEATURED · 干湿闭环平台</b><span>汇集前沿 AI4S 模型与端到端工作流 · 覆盖生命、物质、地球与通用四大领域</span></div>' +
          apps.map(function(x){ return '<div class="card"><b>' + x.name + '</b><span>' + (x.domain || '') + ' · ' + (x.summary || '') + '</span></div>'; }).join('') +
          '<div class="card" style="grid-column:1/-1"><b>我的干湿闭环申请 · ' + reqs.length + ' 个</b><span>' +
            (reqs.length ? reqs.map(function(r){ return r.title + '（' + r.status + '）'; }).join(' · ') : '暂无申请') + '</span></div>';
      } catch (e) {
        body.innerHTML = '<div class="card"><b>加载失败</b><span>' + e.message + '</span></div>';
      }
    };
    loadApps();
  }
  if (route === '/compute') {
    body.dataset.skip = '1';
    const loadCompute = async function(){
      body.innerHTML = '<div class="card">加载中…</div>';
      try {
        const [dm, res, disk, tr] = await Promise.all([
          fetch('/api/ml/v1/dev-machine/list').then(function(r){ return r.json(); }),
          fetch('/api/ml/v1/dev-machine/user_resource').then(function(r){ return r.json(); }),
          fetch('/api/ml/v1/cloud-disk/quota').then(function(r){ return r.json(); }),
          fetch('/api/ml/v1/training/list').then(function(r){ return r.json(); }),
        ]);
        const machines = (dm && dm.data && dm.data.list) || [];
        const r = (res && res.data) || {};
        const d = (disk && disk.data) || {};
        const tasks = (tr && tr.data && tr.data.list) || [];
        const section = function(title, hint){
          return '<div class="card" style="grid-column:1/-1"><b>' + title + '</b><span>' + hint + '</span></div>';
        };
        body.innerHTML = section('开发机管理 · ' + (r.running || 0) + ' 运行中 / ' + (r.quota || 0) + ' 配额', r.gpu_type || '') +
          machines.map(function(m){ return '<div class="card"><b>' + m.name + '</b><span>' + (m.status || '') + ' · ' + (m.gpu || '') + ' · 配额 ' + (m.quota || '') + '</span></div>'; }).join('') +
          section('云盘管理', '已用 ' + (d.used_gb ?? '-') + ' GB / ' + (d.total_gb ?? '-') + ' GB · 文件 ' + (d.file_count || 0)) +
          section('训练任务管理 · ' + tasks.length + ' 个', '') +
          tasks.map(function(t){ return '<div class="card"><b>' + t.name + '</b><span>' + (t.status || '') + ' · ' + (t.gpu || '') + ' · ' + (t.duration_min || 0) + ' 分钟</span></div>'; }).join('');
      } catch (e) {
        body.innerHTML = '<div class="card"><b>加载失败</b><span>' + e.message + '</span></div>';
      }
    };
    loadCompute();
  }
  if (route === '/token-plan/home') {
    const bar = document.createElement('div');
    bar.className = 'row';
    bar.innerHTML = '<select id="tpTab"><option value="models">模型列表</option><option value="keys">API Key</option><option value="usage">用量查询</option></select>';
    view.insertBefore(bar, body);
    // 顶部余额卡
    const bal = document.createElement('div');
    bal.className = 'row';
    bal.id = 'tpBalance';
    bal.innerHTML = '<span class="viewHint">余额加载中…</span>';
    view.insertBefore(bal, body);
    body.dataset.skip = '1';
    const loadTab = async function(){
      const tab = (document.querySelector('#tpTab') || {}).value || 'models';
      const ep = tab === 'keys' ? '/api/tokenplan/v1/keys' : tab === 'usage' ? '/api/tokenplan/v1/usage/summary' : '/api/tokenplan/v1/models';
      body.innerHTML = '<div class="card">加载中…</div>';
      try {
        const r = await fetch(ep, { headers: { accept: 'application/json' } });
        const j = await r.json();
        const d = (j && j.data) || {};
        if (tab === 'usage') {
          body.innerHTML = '<div class="card" style="grid-column:1/-1"><b>用量（' + (d.period || '') + '）</b><span>请求 ' + (d.requests || 0) + ' · 输入 ' + (d.prompt_tokens || 0) + ' · 输出 ' + (d.completion_tokens || 0) + ' · 合计 ' + (d.total_tokens || 0) + '</span></div>';
        } else if (tab === 'keys') {
          body.innerHTML = (d.list || []).map(function(k){ return '<div class="card"><b>' + k.name + '</b><span>' + (k.masked || '') + ' · ' + (k.status || '') + ' · ' + (k.created_at || '') + '</span></div>'; }).join('');
        } else {
          body.innerHTML = (d.list || []).map(function(m){ return '<div class="card"><b>' + m.name + '</b><span>' + (m.context || '') + ' · ' + (m.pricing || '') + '</span></div>'; }).join('');
        }
      } catch (e) {
        body.innerHTML = '<div class="card"><b>加载失败</b><span>' + e.message + '</span></div>';
      }
    };
    fetch('/api/tokenplan/v1/credits/balance').then(function(r){ return r.json(); }).then(function(j){
      const d = (j && j.data) || {};
      const el = document.querySelector('#tpBalance');
      if (el) el.innerHTML = '<span class="viewHint">余额：' + (d.balance ?? '-') + ' ' + (d.currency || '') + ' · 下次重置 ' + (d.next_reset || '-') + '</span>';
    }).catch(function(){});
    const sel = document.querySelector('#tpTab');
    if (sel) sel.addEventListener('change', loadTab);
    loadTab();
  }
  if (route === '/dataset') {
    body.addEventListener('click', async function(ev){
      const card = ev.target.closest ? ev.target.closest('.card') : null;
      if (!card) return;
      const nameEl = card.querySelector('b');
      const name = nameEl ? nameEl.innerText : '';
      body.innerHTML = '<div class="card">加载详情…</div>';
      try {
        const r = await fetch('/api/datasets/v1/dataset/detail');
        const j = await r.json();
        const d = (j && j.data) || {};
        body.innerHTML = '<div class="card" style="grid-column:1/-1"><b>' + (d.name || name) + '</b>' +
          '<span>' + (d.domain || '') + ' · ' + (d.size || '') + ' · ' + (d.license || '') + ' · 文件 ' + (d.files || 0) + '</span>' +
          '<div style="margin-top:6px;font-size:13px">' + (d.description || '') + '</div>' +
          '<div style="margin-top:6px;color:#8a8f99;font-size:12px">标签：' + ((d.labels || []).join(' · ')) + '</div>' +
          '<div style="margin-top:10px"><button id="dsBack">← 返回列表</button></div></div>';
        const back = document.querySelector('#dsBack');
        if (back) back.addEventListener('click', function(){ showRoute('/dataset'); });
      } catch (e) {
        body.innerHTML = '<div class="card"><b>详情加载失败</b><span>' + e.message + '</span></div>';
      }
    });
  }
  if (route === '/paper') {
    const box = document.createElement('div');
    box.className = 'row';
    box.innerHTML = '<select id="paperTab"><option value="works">论文</option><option value="authors">作者</option><option value="journals">期刊</option></select>' +
      '<input id="paperQuery" placeholder="输入检索词，例如：protein / crystal / labs"> <button id="paperGo" class="primary">检索</button>';
    view.insertBefore(box, body);
    const runSearch = async function(){
      const q = (document.querySelector('#paperQuery') || {}).value || '';
      body.innerHTML = '<div class="card">检索中…</div>';
      try {
        const tab = (document.querySelector('#paperTab') || {}).value || 'works';
        const ep = tab === 'authors' ? '/api/nova/v1/search/authors' : tab === 'journals' ? '/api/nova/v1/search/journals' : '/api/nova/v1/search/works';
        const r = await fetch(ep + '?query=' + encodeURIComponent(q.trim()), { headers: { accept: 'application/json' } });
        const j = await r.json();
        const d = (j && j.data) || {};
        const tabNow = (document.querySelector('#paperTab') || {}).value || 'works';
        const card = function(x){
          if (tabNow === 'authors') return '<div class="card"><b>' + x.name + '</b><span>' + (x.affiliation || '') + ' · 论文 ' + (x.papers || 0) + ' · 引用 ' + (x.citations || 0) + '</span></div>';
          if (tabNow === 'journals') return '<div class="card"><b>' + x.name + '</b><span>' + (x.issn || '') + ' · 论文 ' + (x.papers || 0) + ' · ' + (x.impact || '') + '</span></div>';
          return '<div class="card"><b>' + x.title + '</b><span>' + (x.venue || '') + ' · ' + (x.year || '') + ' · 引用 ' + (x.citations || 0) + '</span></div>';
        };
        body.innerHTML = (d.list || []).map(card).join('') || '<div class="card"><b>无结果</b><span>换个检索词试试</span></div>';
      } catch (e) {
        body.innerHTML = '<div class="card"><b>检索失败</b><span>' + e.message + '</span></div>';
      }
    };
    const goBtn = document.querySelector('#paperGo');
    if (goBtn) goBtn.addEventListener('click', runSearch);
    const qInput = document.querySelector('#paperQuery');
    if (qInput) qInput.addEventListener('keydown', function(ev){ if (ev.key === 'Enter') runSearch(); });
  }
  try {
    if (body.dataset.skip === '1') return;
    const r = await fetch(v.api, { headers: { accept: 'application/json' } });
    const j = await r.json();
    const html = v.render((j && j.data) || {});
    body.innerHTML = html || '<div class="card"><b>空</b><span>接口返回空列表</span></div>';
  } catch (e) {
    body.innerHTML = '<div class="card" style="grid-column:1/-1"><b>请求失败</b><span>' + e.message + '</span></div>';
  }
}
document.querySelectorAll('[data-route]').forEach(function(el){ el.addEventListener('click', function(ev){ ev.preventDefault(); const route = el.dataset.route; if (route === '/chat') { document.querySelector('#new').click(); showRoute('/chat'); return; } showRoute(route); }); });
window.addEventListener('hashchange', function(){ showRoute(location.hash || '/chat', false); });
if (location.hash && location.hash !== '/chat' && location.hash !== '#') showRoute(location.hash, false);
</script></body></html>`;

export function createMockGatewayServer(opts = {}) {
  const marker = opts.syntheticMarker ?? 'synthetic';
  const answerText = opts.answerText ?? 'OK';
  const withTool = opts.withTool === true;
  const log = opts.log ?? (() => {});
  let chatSeq = 7000000;
  let midSeq = 1400000;
  const webCancelled = new Map();
  const requestCount = { total: 0 };

  const server = http.createServer(async (req, res) => {
    requestCount.total += 1;
    const url = new URL(req.url, 'http://localhost');
    const raw = url.pathname;
    const path = raw.includes('/api/orbit/v1') ? raw.slice(raw.indexOf('/api/orbit/v1')) : raw;
    const method = req.method;
    const send = (code, body, headers = {}) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', ...headers }); res.end(body); };

    try {
      if (method === 'GET' && (path === '/report' || path.endsWith('/report'))) {
        log('GET /report -> html');
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        return res.end(renderReportHtml());
      }
      if (method === 'GET' && (path === '/' || path.endsWith('/chat') || path.endsWith('/ui') || path.endsWith('/index.html'))) {
        log('GET / (chat ui) -> html');
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        return res.end(CHAT_HTML);
      }
      if (method === 'GET' && path.endsWith('/debug')) {
        log('GET /debug -> html');
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        return res.end(DEBUG_HTML);
      }
      if (method === 'GET' && (path === '/health' || path.endsWith('/health'))) {
        log('GET /health -> 200');
        return send(200, JSON.stringify({ ok: true, synthetic: true, protocol: 'inkstone-desktop-mock', requests: requestCount.total }));
      }
      if (method === 'POST' && path === '/api/orbit/v1/chat/new') {
        const id = ++chatSeq; log(`POST /chat/new -> id=${id}`);
        return send(200, envelope({ id }));
      }
      // ===== 网页协议（依据 04-contracts/api-contract.md + web-a5/web-a6）=====
      // 公开接口（未登录态实测 200，形状见 03-analysis/web-endpoints-r2.md §5）
      if (method === 'GET' && path === '/api/datasets/v1/dataset/square_list') {
        log('GET /datasets/v1/dataset/square_list -> 200 (synthetic)');
        return send(200, JSON.stringify({ code: 0, data: { list: [
          { id: 101, name: '蛋白质结构数据集', domain: '生命科学', size: '12.4 GB', downloads: 3821, description: 'PDB 衍生结构集合' },
          { id: 102, name: '全球气象再分析', domain: '地球科学', size: '88.1 GB', downloads: 1290, description: 'ERA5 子集' },
          { id: 103, name: '材料晶体结构库', domain: '物质科学', size: '5.7 GB', downloads: 964, description: 'Materials Project 子集' },
        ], total: 3 } }));
      }
      if (method === 'GET' && path === '/api/datasets/v1/dataset/detail') {
        log('GET /datasets/v1/dataset/detail -> 200 (synthetic)');
        return send(200, JSON.stringify({ code: 0, data: {
          id: 101, name: '蛋白质结构数据集', domain: '生命科学', size: '12.4 GB',
          license: 'CC BY 4.0', files: 12840, downloads: 3821,
          description: 'PDB 衍生的蛋白质结构集合，覆盖 12 万个结构条目。',
          labels: ['结构生物学', '蛋白质', 'PDB'],
        } }));
      }
      if (method === 'POST' && path === '/api/tokenplan/v1/keys/create') {
      const body = await readBody(req);
      const item = { id: 'key_' + (++seq), name: String(body.name || '新建 Key'), masked: 'sk-****' + Math.floor(Math.random() * 9000 + 1000), status: 'active', created_at: new Date().toISOString() };
      store.keys.push(item);
      log('POST /tokenplan/v1/keys/create -> 200 (stateful, ' + store.keys.length + ')');
      return send(200, JSON.stringify({ code: 0, data: item }));
      }
      if (method === 'GET' && path === '/api/tokenplan/v1/keys') {
      log('GET /tokenplan/v1/keys -> 200 (stateful, ' + store.keys.length + ')');
      return send(200, JSON.stringify({ code: 0, data: { list: store.keys, total: store.keys.length } }));
      }
      if (method === 'GET' && path === '/api/tokenplan/v1/usage/summary') {
        log('GET /tokenplan/v1/usage/summary -> 200 (synthetic)');
        return send(200, JSON.stringify({ code: 0, data: { total_tokens: 1284000, prompt_tokens: 902000, completion_tokens: 382000, requests: 1840, period: '2026-10' } }));
      }
      if (method === 'GET' && path === '/api/tokenplan/v1/credits/balance') {
        log('GET /tokenplan/v1/credits/balance -> 200 (synthetic)');
        return send(200, JSON.stringify({ code: 0, data: {
          balance: 386.5, currency: 'CNY', next_reset: '2026-11-01',
          usage_windows: {
            '5h': { enabled: true, limit_credits: 100, remaining_credits: 62, next_recover_at: '2026-10-20T22:00:00Z', resets_at: '2026-10-20T22:00:00Z' },
            '7d': { enabled: true, limit_credits: 800, remaining_credits: 410, next_recover_at: '2026-10-27T00:00:00Z', resets_at: '2026-10-27T00:00:00Z' },
          },
        } }));
      }
      if (method === 'GET' && path === '/api/tokenplan/v1/models') {
        log('GET /tokenplan/v1/models -> 200 (synthetic)');
        return send(200, JSON.stringify({ code: 0, data: { list: [
          { name: '书生-S2', context: '128K', pricing: '￥0.002/1K', status: 'available' },
          { name: 'Qwen3.8-Max', context: '256K', pricing: '￥0.004/1K', status: 'available' },
          { name: 'DeepSeek-V4-Flash', context: '64K', pricing: '￥0.0005/1K', status: 'available' },
        ], total: 3 } }));
      }
      if (method === 'GET' && path === '/api/spacebe/v1/space/assets/files') {
      const id = String((url.searchParams && url.searchParams.get('id')) || store.spaces[0].id);
      const list = store.files[id] || [];
      log('GET /spacebe/v1/space/assets/files id=' + id + ' -> 200 (' + list.length + ' files)');
      return send(200, JSON.stringify({ code: 0, data: { list, total: list.length } }));
      }
      if (method === 'POST' && path === '/api/spacebe/v1/space/create') {
      const body = await readBody(req);
      const item = { id: 'sp' + (++seq), name: String(body.name || '新建课题'), field: String(body.field || '通用'), description: String(body.description || ''), members: 1, files: 0, updated_at: new Date().toISOString() };
      store.spaces.unshift(item);
      store.files[item.id] = [];
      log('POST /spacebe/v1/space/create -> 200 (stateful, now ' + store.spaces.length + ')');
      return send(200, JSON.stringify({ code: 0, data: item }));
      }
      if (method === 'GET' && path === '/api/spacebe/v1/space/details') {
      const id = String((url.searchParams && url.searchParams.get('id')) || store.spaces[0].id);
      const item = store.spaces.filter((x) => String(x.id) === id)[0] || store.spaces[0];
      log('GET /spacebe/v1/space/details id=' + id + ' -> 200 (stateful)');
      return send(200, JSON.stringify({ code: 0, data: Object.assign({}, item, { files: (store.files[item.id] || []).length }) }));
      }
      if (method === 'GET' && path === '/api/moce/v1/dry_wet_loop/apply/status/list') {
      log('GET /moce/v1/dry_wet_loop/apply/status/list -> 200 (stateful, ' + store.applies.length + ')');
      return send(200, JSON.stringify({ code: 0, data: { list: store.applies, total: store.applies.length } }));
      }
      if (method === 'GET' && path === '/api/moce/v1/apps/detail') {
        const id = String((url.searchParams && url.searchParams.get('id')) || 'app1');
        log('GET /moce/v1/apps/detail id=' + id + ' -> 200 (synthetic)');
        return send(200, JSON.stringify({ code: 0, data: { id: id, name: '干湿闭环平台', domain: '生命科学', summary: '从假设到湿实验的一体化编排（本地合成）', features: ['方案生成', '实验排期', '结果回流'], entry: '/app/dry-wet' } }));
      }
      if (method === 'POST' && path === '/api/moce/v1/dry_wet_loop/apply') {
      const body = await readBody(req);
      const item = { id: 'dw' + (++seq), title: String(body.title || '干湿闭环申请'), status: 'submitted', submitted_at: new Date().toISOString(), owner: '本地用户' };
      store.applies.unshift(item);
      log('POST /moce/v1/dry_wet_loop/apply -> 200 (stateful, ' + store.applies.length + ')');
      return send(200, JSON.stringify({ code: 0, data: item }));
      }
      if (method === 'GET' && path === '/api/moce/v1/apps/list') {
        log('GET /moce/v1/apps/list -> 200 (synthetic)');
        return send(200, JSON.stringify({ code: 0, data: { list: [
          { id: 1, name: '干湿闭环平台', domain: '通用', summary: 'AI4S 干湿闭环工作流' },
          { id: 2, name: '蛋白质结构预测', domain: '生命科学', summary: '序列到结构预测' },
          { id: 3, name: '材料发现', domain: '物质科学', summary: '晶体与材料筛选' },
          { id: 4, name: '地球系统模拟', domain: '地球科学', summary: '多圈层耦合模拟' },
        ], total: 4 } }));
      }
      if (method === 'GET' && path === '/api/ml/v1/dev-machine/user_resource') {
        log('GET /ml/v1/dev-machine/user_resource -> 200 (synthetic)');
        return send(200, JSON.stringify({ code: 0, data: { running: 1, quota: 2, cpu_cores: 32, gpu_type: 'A100 80G' } }));
      }
      if (method === 'GET' && path === '/api/ml/v1/training/list') {
        log('GET /ml/v1/training/list -> 200 (synthetic)');
        return send(200, JSON.stringify({ code: 0, data: { list: [
          { id: 'tr-1', name: 'yolov8-baseline', status: 'running', duration_min: 128, gpu: 'A100 80G' },
          { id: 'tr-2', name: 'coco-finetune', status: 'finished', duration_min: 436, gpu: 'A100 80G' },
        ], total: 2 } }));
      }
      if (method === 'POST' && (path === '/api/ml/v1/dev-machine/start' || path === '/api/ml/v1/dev-machine/stop')) {
      const body = await readBody(req);
      const want = path.endsWith('start') ? 'running' : 'stopped';
      const m = store.machines.filter((x) => String(x.id) === String(body.id) || x.name === String(body.id))[0];
      if (m) m.status = want;
      log('POST ' + path + ' id=' + String(body.id) + ' -> 200 (now ' + (m ? m.status : 'not-found') + ')');
      return send(200, JSON.stringify({ code: 0, data: { ok: !!m, id: body.id, status: m ? m.status : undefined } }));
      }
      if (method === 'GET' && path === '/api/ml/v1/cloud-disk/list') {
        log('GET /ml/v1/cloud-disk/list -> 200 (synthetic)');
        return send(200, JSON.stringify({ code: 0, data: { list: [
          { name: 'train.py', type: 'file', size: 4210 },
          { name: 'coco.yaml', type: 'file', size: 1204 },
          { name: 'runs/', type: 'dir', size: 0 },
        ], total: 3 } }));
      }
      if (method === 'GET' && path === '/api/ml/v1/dev-machine/list') {
      log('GET /ml/v1/dev-machine/list -> 200 (stateful)');
      return send(200, JSON.stringify({ code: 0, data: { list: store.machines, total: store.machines.length } }));
      }
      if (method === 'GET' && path === '/api/ml/v1/cloud-disk/quota') {
        log('GET /ml/v1/cloud-disk/quota -> 200 (synthetic)');
        return send(200, JSON.stringify({ code: 0, data: { used_gb: 12.5, total_gb: 100, file_count: 42 } }));
      }
      if (method === 'GET' && path === '/api/nova/v1/search/works') {
        const q = String((url.searchParams && url.searchParams.get('query')) || '').trim() || '(空)';
        log('GET /nova/v1/search/works query=' + q + ' -> 200 (synthetic)');
        const all = [
          { id: 'w1', title: 'Deep learning for protein structure prediction', venue: 'Nature', year: 2024, citations: 1280, angle_name: '结构预测' },
          { id: 'w2', title: 'Foundation models for scientific discovery', venue: 'Science', year: 2025, citations: 640, angle_name: '基础模型' },
          { id: 'w3', title: 'AI4S: from tools to autonomous labs', venue: 'Cell', year: 2025, citations: 315, angle_name: '自主实验' },
          { id: 'w4', title: 'Crystal graph networks for materials screening', venue: 'Nature Materials', year: 2024, citations: 428, angle_name: '材料筛选' },
        ];
        const hit = all.filter(function(x){ return (x.title + ' ' + x.venue + ' ' + x.angle_name).toLowerCase().indexOf(q.toLowerCase()) >= 0; });
    const mode = String((url.searchParams && url.searchParams.get('mode')) || '');
        const list = hit.length ? hit : all.slice(0, 2);
        return send(200, JSON.stringify({ code: 0, data: {
          reasoning_process: '按检索词拆分角度：' + q,
          termList: list.map(function(x){ return { angle_name: x.angle_name, query: q, count: x.citations }; }),
          total_count: list.length,
          list: list.map(function (x) {
            return Object.assign({}, x, {
              authors: x.id === 'w1' ? ['Zhang Y.', 'Li M.'] : x.id === 'w2' ? ['Chen H.', 'Wang X.'] : ['Liu Q.'],
              abstract: '本文围绕「' + x.angle_name + '」提出方法并在多个基准上验证（本地合成摘要，可用于展开全文）。',
              tags: [x.angle_name, x.venue],
              type: x.id === 'w3' ? '会议' : '期刊',
              free_pdf: x.id === 'w1' || x.id === 'w4',
            });
          }),
        } }));
      }
      if (method === 'POST' && path === '/api/nova/v1/paper/check') {
        const body = await readBody(req);
        const text = String(body.text || '');
        const mode = String(body.mode || 'consistency');
        const items = [
          { claim: '正文观点：所提方法在多任务上优于基线', ref: 'Smith et al., 2023', verdict: '正确', evidence: '摘要与结果表支持该表述（本地合成）' },
          { claim: '正文观点：训练数据规模达到 1TB', ref: 'Chen et al., 2024', verdict: '存疑', evidence: '原文仅提及 200GB，量级不符（本地合成）' },
          { claim: '正文观点：某作者提出相反结论', ref: 'Li et al., 2022', verdict: '未核验', evidence: '未能检索到该条目（本地合成）' },
        ];
        const stats = { all: items.length, correct: items.filter((x) => x.verdict === '正确').length, doubtful: items.filter((x) => x.verdict === '存疑').length, unchecked: items.filter((x) => x.verdict === '未核验').length };
        log('POST /nova/v1/paper/check mode=' + mode + ' len=' + text.length + ' -> 200 (synthetic ' + stats.all + ' 条)');
        return send(200, JSON.stringify({ code: 0, data: { mode: mode, stats: stats, items: items } }));
      }
      if (method === 'GET' && path === '/api/nova/v1/paper/detail') {
        const id = String((url.searchParams && url.searchParams.get('id')) || 'w1');
        const base = id === 'w2' ? { title: 'Foundation models for scientific discovery', venue: 'Science', year: 2025, citations: 640 }
          : id === 'w3' ? { title: 'AI4S: from tools to autonomous labs', venue: 'Cell', year: 2025, citations: 315 }
          : id === 'w4' ? { title: 'Crystal graph networks for materials screening', venue: 'Nature Materials', year: 2024, citations: 428 }
          : { title: 'Deep learning for protein structure prediction', venue: 'Nature', year: 2024, citations: 1280 };
        log('GET /nova/v1/paper/detail id=' + id + ' -> 200 (synthetic)');
        return send(200, JSON.stringify({ code: 0, data: Object.assign({ id: id, abstract: '本文提出一种面向科学发现的方法，并在多个基准上验证其有效性（本地合成摘要）。', authors: ['Zhang Y.', 'Li M.', 'Wang X.'], doi: '10.1000/local.' + id, open_access: true }, base) }));
      }
      if (method === 'GET' && path === '/api/nova/v1/search/authors') {
        log('GET /nova/v1/search/authors -> 200 (synthetic)');
        return send(200, JSON.stringify({ code: 0, data: { list: [
          { id: 'a1', name: 'Jumper J.', affiliation: 'DeepMind', papers: 42, citations: 52000 },
          { id: 'a2', name: 'Zhang Y.', affiliation: 'Shanghai AI Lab', papers: 61, citations: 8800 },
        ], total: 2 } }));
      }
      if (method === 'GET' && path === '/api/nova/v1/search/journals') {
        log('GET /nova/v1/search/journals -> 200 (synthetic)');
        return send(200, JSON.stringify({ code: 0, data: { list: [
          { id: 'j1', name: 'Nature', issn: '0028-0836', papers: 128000, impact: 'IF 50.5' },
          { id: 'j2', name: 'Science', issn: '0036-8075', papers: 96000, impact: 'IF 44.7' },
        ], total: 2 } }));
      }
      if (method === 'GET' && path === '/api/nova/v1/search/recent-searches') {
        log('GET /nova/v1/search/recent-searches -> 200 (synthetic)');
        return send(200, JSON.stringify({ code: 0, data: { list: ['protein structure', 'crystal screening'], total: 2 } }));
      }
      if (method === 'GET' && path === '/api/nova/v1/search/hot-papers') {
        log('GET /nova/v1/search/hot-papers -> 200 (synthetic)');
        return send(200, JSON.stringify({ code: 0, data: { list: [
          { id: 'w1', title: 'Deep learning for protein structure prediction', venue: 'Nature', year: 2024, citations: 1280 },
          { id: 'w2', title: 'Foundation models for scientific discovery', venue: 'Science', year: 2025, citations: 640 },
          { id: 'w3', title: 'AI4S: from tools to autonomous labs', venue: 'Cell', year: 2025, citations: 315 },
        ], total: 3 } }));
      }
      if (method === 'GET' && path === '/api/spacebe/v1/space/list') {
      log('GET /spacebe/v1/space/list -> 200 (stateful, ' + store.spaces.length + ' spaces)');
      return send(200, JSON.stringify({ code: 0, data: { list: store.spaces, total: store.spaces.length } }));
      }
      if (method === 'POST' && path === '/api/scphub/v1/scp/use') {
        const body = await readBody(req);
        const item = SCP_ITEMS.filter((x) => x.id === String(body.id))[0];
        if (item) item.downloads = Number(item.downloads || 0) + 1;
        log('POST /scphub/v1/scp/use id=' + String(body.id) + ' -> 200 (stateful, downloads=' + (item ? item.downloads : '-') + ')');
        return send(200, JSON.stringify({ code: 0, data: { ok: !!item, id: body.id, downloads: item ? item.downloads : undefined } }));
      }
      if (method === 'POST' && path === '/api/datasets/v1/dataset/download-request') {
        const body = await readBody(req);
        const item = { id: 'dl' + (++seq), dataset_id: String(body.id || ''), name: String(body.name || '数据集'), requested_at: new Date().toISOString() };
        store.downloads.unshift(item);
        log('POST /datasets/v1/dataset/download-request -> 200 (stateful, ' + store.downloads.length + ')');
        return send(200, JSON.stringify({ code: 0, data: item }));
      }
      if (method === 'GET' && path === '/api/datasets/v1/dataset/downloads') {
        log('GET /datasets/v1/dataset/downloads -> 200 (' + store.downloads.length + ')');
        return send(200, JSON.stringify({ code: 0, data: { list: store.downloads, total: store.downloads.length } }));
      }
      if (method === 'GET' && path === '/api/scphub/v1/scp/list') {
        const tag = String((url.searchParams && url.searchParams.get('tag')) || '');
        const all = SCP_ITEMS;
        const _unused = [
          { id: 'scp1', name: '蛋白结构预测', tag: '生命科学', type: 'SCP', downloads: 1280 },
          { id: 'scp2', name: '气候模式降尺度', tag: '地球科学', type: 'SCP', downloads: 860 },
          { id: 'scp3', name: '晶体结构筛选', tag: '物质科学', type: 'Skills', downloads: 2140 },
          { id: 'scp4', name: '单细胞聚类', tag: '生命科学', type: 'Skills', downloads: 530 },
          { id: 'scp5', name: '光子能量计算', tag: '物理科学', type: 'SCP', downloads: 310 },
        ];
        const list = tag && tag !== '全部领域' ? all.filter(x => x.tag === tag) : all;
        log('GET /scphub/v1/scp/list tag=' + (tag || '-') + ' -> 200 (synthetic)');
        return send(200, JSON.stringify({ code: 0, data: { list: list, total: list.length } }));
      }
      if (method === 'GET' && path === '/api/scphub/v1/scp/tags') {
        log('GET /scphub/v1/scp/tags -> 200 (public)');
        return send(200, JSON.stringify({ code: 0, data: SCp_TAGS }));
      }
      if (method === 'GET' && path === '/api/datasets/v1/category/list') {
        log('GET /datasets/v1/category/list -> 200 (public)');
        return send(200, JSON.stringify({ code: 0, data: DATASET_CATEGORIES }));
      }
      if (method === 'GET' && path === '/api/orbit/v1/models') {
        log('GET /models -> 200 (web)');
        return send(200, JSON.stringify({ code: 0, data: { models: WEB_MODELS } }));
      }
      if (method === 'POST' && path === '/api/orbit/v1/chat') {
        const body = await readBody(req);
        const cid = body?.chat_id ?? ++chatSeq;
        const mid = ++midSeq;
        const st = { cancelled: false };
        webCancelled.set(String(cid), st);
        log(`POST /chat chat_id=${cid} model=${body?.model} thinking=${body?.thinking_mode} -> SSE (web)`);
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
        const emit = (o) => { if (!res.writableEnded) res.write('data: ' + JSON.stringify(o) + '\n\n'); };
        emit({ event: 'workflow_started', cid, mid });
        await sleepMs(120);
        if (!st.cancelled && body?.thinking_mode) emit({ event: 'message', thinking: '这是合成的思考增量（网页协议 message.thinking）。', cid, mid });
        for (const ch of answerText.split('')) {
          await sleepMs(60);
          if (st.cancelled) break;
          emit({ event: 'message', answer: ch, cid, mid });
        }
        emit({ event: 'message_end', cid, mid, ...(st.cancelled ? { stopped: true } : {}) });
        if (!st.cancelled) emit({ event: 'followup', followup: [{ text: '继续追问示例', type: 1, extra: null }] });
        emit({ event: 'workflow_finished', cid, mid });
        webCancelled.delete(String(cid));
        return res.end();
      }
      const mStop = path.match(/^\/api\/orbit\/v1\/chat\/(\d+)\/stop$/);
      if (method === 'POST' && mStop) {
        const body = await readBody(req);
        const st = webCancelled.get(String(mStop[1]));
        if (st) st.cancelled = true;
        log(`POST /chat/${mStop[1]}/stop message_id=${body?.message_id} -> 200 (cancelled=${!!st})`);
        return send(200, JSON.stringify({ code: 0, data: { stopped: !!st, chat_id: Number(mStop[1]), message_id: body?.message_id ?? null } }));
      }
      const mDetail = path.match(/^\/api\/orbit\/v1\/chat\/(\d+)(\/detail)?$/);
      if (method === 'GET' && mDetail) {
        const id = Number(mDetail[1]);
        const mid = id * 10 + 1;
        log('GET /chat/' + id + (mDetail[2] ? '/detail' : '') + ' -> 200 (web, synthetic)');
        return send(200, JSON.stringify({ code: 0, data: {
          id: id, chat_id: id, title: '合成会话（离线）', scenario: 1,
          messages: [{ id: String(mid), chat_id: id, message_id: mid, request: '本地 mock：请只回复 OK', response: 'OK', status: 1, model: 'Default', created_at: new Date().toISOString(), thinking: false }],
          turns: [], total: 1,
        } }));
      }
      if (method === 'GET' && path === '/api/orbit/v1/chat/list') {
        log('GET /chat/list -> 200 (web)');
        return send(200, JSON.stringify({ code: 0, data: { list: [{ id: chatSeq, chat_id: chatSeq, title: '合成会话（离线）', name: '合成会话（离线）', scenario: 1, updated_at: new Date().toISOString(), created_at: new Date().toISOString() }], total: 1, page: 1, size: 20 } }));
      }
      if (method === 'GET' && path === '/api/orbit/v1/local-agent/models') {
        log('GET /local-agent/models -> 200');
        return send(200, envelope(CAPABILITIES(marker)));
      }
      if (method === 'POST' && path === '/api/orbit/v1/local-agent/messages') {
        const body = await readBody(req);
        const events = [
          { type: 'message_start', response_id: 'synthetic-resp-1', model: body?.model ?? 'synthetic-model-a' },
          { type: 'thinking_delta', text: '这是合成的思考增量（演示 thinking_delta）。' },
          ...(withTool ? [
            { type: 'tool_use_start', id: 'call_syn_1', name: 'echo' },
            { type: 'tool_input_delta', id: 'call_syn_1', partial_json: '{"x":' },
            { type: 'tool_input_delta', id: 'call_syn_1', partial_json: '1}' },
            { type: 'tool_use_end', id: 'call_syn_1', input: { x: 1 } },
          ] : []),
          ...answerText.split('').map((ch) => ({ type: 'content_delta', text: ch })),
          { type: 'usage', usage: { input_tokens: 5, output_tokens: answerText.length, cache_read_tokens: 0, cache_write_tokens: 0 } },
          { type: 'message_end', stop_reason: withTool ? 'tool_use' : 'end_turn' },
        ];
        log(`POST /local-agent/messages chat_id=${body?.chat_id} -> SSE (${events.length} events)`);
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
        res.write(gsse(events));
        return res.end();
      }
      const mTurn = path.match(/^\/api\/orbit\/v1\/chat\/(\d+)\/local-turns$/);
      if (method === 'POST' && mTurn) { log(`POST ${path} -> 200`); return send(200, envelope({ turn_id: 'turn_syn_1', message_id: 11, status: 'running', checkpoint_seq: 0 })); }
      const mChk = path.match(/^\/api\/orbit\/v1\/chat\/(\d+)\/local-turns\/([^/]+)\/checkpoint$/);
      if (method === 'POST' && mChk) { log(`POST ${path} -> 200`); return send(200, envelope({ applied: true, status: 'running', checkpoint_seq: 1 })); }
      const mCom = path.match(/^\/api\/orbit\/v1\/chat\/(\d+)\/local-turns\/([^/]+)\/complete$/);
      if (method === 'POST' && mCom) { log(`POST ${path} -> 200`); return send(200, envelope({ turn_id: decodeURIComponent(mCom[2]), message_id: 11, status: 'complete', checkpoint_seq: 2, usage: { input_tokens: 5, output_tokens: answerText.length, cache_read_tokens: 0, cache_write_tokens: 0 } })); }

      log(`${method} ${path} -> 404`);
      if (path.startsWith('/api/')) {
        log(method + ' ' + path + ' -> 200 (fallback empty)');
        return send(200, JSON.stringify({ code: 0, data: { list: [], total: 0 } }));
      }
      return send(404, JSON.stringify({ msg: 'not found', trace_id: 'synthetic-trace', code: 404 }));
    } catch (e) {
      log(`${method} ${path} -> 500 ${String(e.message).slice(0, 80)}`);
      return send(500, JSON.stringify({ msg: 'error', trace_id: 'synthetic-trace', code: 500 }));
    }
  });
  server.requestCount = requestCount;
  return server;
}

// Windows: 盘符路径不能直接拼成 file:// URL，必须用 pathToFileURL 比较
const __isMain = (() => { try { return !!process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url; } catch { return false; } })();
if (__isMain) {
  const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
  const host = arg('host', '0.0.0.0');
  const port = Number(arg('port', 8787));
  const server = createMockGatewayServer({ log: (m) => console.log('[mock-gateway] ' + m) });
  server.listen(port, host, () => {
    console.log(`[mock-gateway] listening on http://${host}:${port}  (synthetic, offline)`);
    console.log('[mock-gateway] / = 逆向协议演示页 · /debug = 端点调试 · /health · API 前缀 /api/orbit/v1');
  });
}
