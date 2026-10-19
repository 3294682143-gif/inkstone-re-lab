// tools/mock-gateway.mjs
// 本地离线 mock gateway + 逆向协议演示页。
// - `/`      逆向出的“完整页面”：可交互聊天（用已确认的桌面协议，流式 SSE）
// - `/debug` 端点调试页（逐个调用）
// - `/health`
// - `/api/orbit/v1/*` 已确认协议子集（合成数据）
// 全部离线、无凭据、不启动 Electron/Windows。
//   node tools/mock-gateway.mjs [--port 8787] [--host 0.0.0.0]
import http from 'node:http';
import { renderReportHtml } from './re-findings-report.mjs';

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
:root{--bg:#0f1115;--panel:#171a21;--line:#262b36;--fg:#e8eaf0;--muted:#9aa3b2;--acc:#5b8cff;--think:#8b93a7}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.6 system-ui,Segoe UI,Arial}
header{padding:12px 18px;border-bottom:1px solid var(--line);display:flex;gap:10px;align-items:center;flex-wrap:wrap}
header b{font-size:15px}.tag{background:#3a1d1d;color:#ff8f8f;border:1px solid #5a2a2a;border-radius:10px;padding:1px 8px;font-size:12px}
.wrap{max-width:920px;margin:0 auto;padding:16px}
.row{display:flex;gap:8px;align-items:center;margin:8px 0;flex-wrap:wrap}
input,select,button{background:var(--panel);color:var(--fg);border:1px solid var(--line);border-radius:8px;padding:8px 10px;font:inherit}
input{flex:1;min-width:220px}button{cursor:pointer}button.primary{background:var(--acc);border-color:var(--acc);color:#fff}
button:disabled{opacity:.5;cursor:not-allowed}
.chat{border:1px solid var(--line);border-radius:12px;padding:12px;min-height:260px;background:var(--panel)}
.msg{margin:10px 0;padding:10px 12px;border-radius:10px;white-space:pre-wrap;word-break:break-word}
.user{background:#1d2740;border:1px solid #2b3c63}
.assistant{background:#141821;border:1px solid var(--line)}
.think{color:var(--think);font-style:italic;border-left:2px solid #3a4152;padding-left:8px;margin:6px 0;white-space:pre-wrap}
.tool{font-family:ui-monospace,Consolas,monospace;font-size:12.5px;color:#cfe3ff;background:#101826;border:1px dashed #2c4a7a;border-radius:8px;padding:6px 8px;margin:6px 0;white-space:pre-wrap}
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
<div class="wrap">
  <div class="row">
    <label>base</label><input id="base">
    <label>model</label><input id="model" value="synthetic-model-a" style="max-width:200px">
    <button id="new">新建会话</button>
    <button id="stop" disabled>停止</button>
  </div>
  <div class="chat" id="chat"><div class="msg assistant">已就绪。点击「新建会话」，然后输入消息发送。协议：<code>/chat/new</code> → <code>/local-agent/messages</code>(SSE, type 事件) → 本地轮次同步。</div></div>
  <div class="row">
    <input id="text" placeholder="输入消息，例如：请只回复 OK" autocomplete="off">
    <button class="primary" id="send">发送</button>
  </div>
  <div class="meta" id="status"></div>
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
  const r=await fetch($('#base').value+'/chat/new',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({scenario:2,type:0,provider:0,agent:'local_agent'})});
  const j=await r.json();
  if(!r.ok||j.code!==0||!j.data?.id){setStatus('创建失败 HTTP '+r.status);return;}
  chatId=j.data.id;$('#ids').textContent='chat_id: '+chatId;setStatus('会话已创建');
}

async function send(){
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

$('#new').addEventListener('click',()=>newConv());
$('#send').addEventListener('click',()=>send());
$('#stop').addEventListener('click',()=>{ if(ac)ac.abort(); });
$('#text').addEventListener('keydown',(e)=>{ if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send();} });
</script></body></html>`;

export function createMockGatewayServer(opts = {}) {
  const marker = opts.syntheticMarker ?? 'synthetic';
  const answerText = opts.answerText ?? 'OK';
  const withTool = opts.withTool === true;
  const log = opts.log ?? (() => {});
  let chatSeq = 7000000;
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

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
  const host = arg('host', '0.0.0.0');
  const port = Number(arg('port', 8787));
  const server = createMockGatewayServer({ log: (m) => console.log('[mock-gateway] ' + m) });
  server.listen(port, host, () => {
    console.log(`[mock-gateway] listening on http://${host}:${port}  (synthetic, offline)`);
    console.log('[mock-gateway] / = 逆向协议演示页 · /debug = 端点调试 · /health · API 前缀 /api/orbit/v1');
  });
}
