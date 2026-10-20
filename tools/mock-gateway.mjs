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
    <button class="primary" id="send">发送</button>
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
    $('#send').disabled=false; $('#stop').disabled=true;
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
  ac=new AbortController(); $('#send').disabled=true; $('#stop').disabled=false;
  setStatus('网页协议：推理中（流式）…');
  let err=null, finished=false;
  try{
    const r=await fetch($('#base').value+'/chat',{method:'POST',signal:ac.signal,headers:{'content-type':'application/json','accept':'text/event-stream'},body:JSON.stringify({scenario:1,thinking_mode:true,planning_mode:false,model,query:text,chat_id:chatId})});
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
    $('#send').disabled=false; $('#stop').disabled=true;
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
    box.innerHTML = '<input id="paperQuery" placeholder="输入检索词，例如：protein / crystal / labs"> <button id="paperGo" class="primary">检索</button>';
    view.insertBefore(box, body);
    const runSearch = async function(){
      const q = (document.querySelector('#paperQuery') || {}).value || '';
      body.innerHTML = '<div class="card">检索中…</div>';
      try {
        const r = await fetch('/api/nova/v1/search/works', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: q.trim() }) });
        const j = await r.json();
        const d = (j && j.data) || {};
        body.innerHTML = (d.list || []).map(function(p){ return '<div class="card"><b>' + p.title + '</b><span>' + (p.venue || '') + ' · ' + (p.year || '') + ' · 引用 ' + (p.citations || 0) + '</span></div>'; }).join('') || '<div class="card"><b>无结果</b><span>换个检索词试试</span></div>';
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
      if (method === 'GET' && path === '/api/tokenplan/v1/models') {
        log('GET /tokenplan/v1/models -> 200 (synthetic)');
        return send(200, JSON.stringify({ code: 0, data: { list: [
          { name: '书生-S2', context: '128K', pricing: '￥0.002/1K', status: 'available' },
          { name: 'Qwen3.8-Max', context: '256K', pricing: '￥0.004/1K', status: 'available' },
          { name: 'DeepSeek-V4-Flash', context: '64K', pricing: '￥0.0005/1K', status: 'available' },
        ], total: 3 } }));
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
      if (method === 'GET' && path === '/api/ml/v1/dev-machine/list') {
        log('GET /ml/v1/dev-machine/list -> 200 (synthetic)');
        return send(200, JSON.stringify({ code: 0, data: { list: [
          { id: 'dm-001', name: 'A100 开发机', status: 'running', gpu: 'A100 80G', quota: '1/1' },
          { id: 'dm-002', name: 'CPU 调试机', status: 'stopped', gpu: '-', quota: '0/1' },
        ], total: 2 } }));
      }
      if (method === 'GET' && path === '/api/ml/v1/cloud-disk/quota') {
        log('GET /ml/v1/cloud-disk/quota -> 200 (synthetic)');
        return send(200, JSON.stringify({ code: 0, data: { used_gb: 12.5, total_gb: 100, file_count: 42 } }));
      }
      if (method === 'POST' && path === '/api/nova/v1/search/works') {
        const body = await readBody(req);
        const q = String(body?.query || '').trim() || '(空)';
        log('POST /nova/v1/search/works query=' + q + ' -> 200 (synthetic)');
        const all = [
          { id: 'w1', title: 'Deep learning for protein structure prediction', venue: 'Nature', year: 2024, citations: 1280 },
          { id: 'w2', title: 'Foundation models for scientific discovery', venue: 'Science', year: 2025, citations: 640 },
          { id: 'w3', title: 'AI4S: from tools to autonomous labs', venue: 'Cell', year: 2025, citations: 315 },
          { id: 'w4', title: 'Crystal graph networks for materials screening', venue: 'Nature Materials', year: 2024, citations: 428 },
        ];
        const hit = all.filter(function(x){ return (x.title + ' ' + x.venue).toLowerCase().indexOf(q.toLowerCase()) >= 0; });
        return send(200, JSON.stringify({ code: 0, data: { query: q, list: hit.length ? hit : all.slice(0, 2), total: hit.length || 2 } }));
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
        log('GET /spacebe/v1/space/list -> 200 (synthetic)');
        return send(200, JSON.stringify({ code: 0, data: { list: [
          { id: 3914, name: 'COCO 与 YOLOv8 复现', description: '目标检测基线复现与方法对比', space_type: 1 },
          { id: 3915, name: '离线回归项目', description: '桌面/网页协议回归验证用', space_type: 1 },
        ], total: 2 } }));
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
        if (!st.cancelled) emit({ event: 'message', thinking: '这是合成的思考增量（网页协议 message.thinking）。', cid, mid });
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
      if (method === 'GET' && path === '/api/orbit/v1/chat/list') {
        log('GET /chat/list -> 200 (web)');
        return send(200, JSON.stringify({ code: 0, data: { list: [{ id: chatSeq, title: '合成会话（离线）', scenario: 1 }], total: 1, page: 1 } }));
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
