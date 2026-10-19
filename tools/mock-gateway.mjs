// tools/mock-gateway.mjs
// 本地离线 mock gateway：实现 inkstone-re-lab 已确认的桌面协议子集，使用**合成数据**。
// 仅用于本地/离线验收：不联网、无凭据、不启动 Electron/Windows。
//   node tools/mock-gateway.mjs [--port 8787] [--host 0.0.0.0]
// 也可被测试 import：createMockGatewayServer({...}) 返回 http.Server。
//
// 首页 `/` 提供一个自包含 HTML，浏览器打开即可逐个调用端点做验收；
// `/health` 返回 {ok, synthetic}。API 路由同时兼容带/不带代理前缀的路径。
import http from 'node:http';

const CAPABILITIES = (syntheticMarker) => ({
  protocol_version: '2.0',
  models: [{
    id: 'synthetic-model-a', canonical_id: 'synthetic-model-a', display_name: 'Synthetic Model A',
    context_window: 100000, max_output_tokens: 8000,
    supports_thinking: true, supports_tools: true, supports_attachments: false,
    answer_transport: 'strict_eof', tags: [syntheticMarker], pro: false,
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

function indexHtml() {
  return `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>inkstone mock gateway</title>
<style>body{font-family:system-ui,Segoe UI,Arial;margin:24px;max-width:900px}pre{background:#f4f4f4;padding:10px;overflow:auto;max-height:320px}button{margin:4px 6px 4px 0;padding:6px 10px}h1{font-size:20px}.tag{color:#b00}</style></head>
<body><h1>inkstone-re-lab · 本地离线 mock gateway</h1>
<p>合成数据；不联网；无凭据。<span class="tag">SYNTHETIC</span></p>
<p>本页在 ModelArts 代理下也可用：点按钮即时调用并显示结果。</p>
<div>
<button data-m="POST" data-p="chat/new" data-b='{"scenario":2,"type":0,"provider":0,"agent":"local_agent"}'>POST /chat/new</button>
<button data-m="GET" data-p="local-agent/models">GET /local-agent/models</button>
<button data-m="POST" data-p="local-agent/messages" data-b='{"chat_id":1,"model":"synthetic-model-a","messages":[],"tools":[]}' data-sse="1">POST /local-agent/messages (SSE)</button>
<button data-m="POST" data-p="chat/1/local-turns" data-b='{}'>POST /chat/1/local-turns</button>
<button data-m="POST" data-p="chat/1/local-turns/turn_syn_1/complete" data-b='{}'>POST .../complete</button>
<button data-m="GET" data-p="health">GET /health</button>
</div>
<pre id="out">(点击上面的按钮查看结果)</pre>
<script>
const BASE = location.pathname.replace(/\\/$/, '');
const out = document.getElementById('out');
document.querySelectorAll('button').forEach((b) => b.addEventListener('click', async () => {
  const url = BASE + '/api/orbit/v1/' + b.dataset.p;
  try {
    const r = await fetch(url, { method: b.dataset.m, headers: { 'content-type': 'application/json', 'accept': b.dataset.sse ? 'text/event-stream' : 'application/json' }, body: b.dataset.b ?? undefined });
    out.textContent = 'HTTP ' + r.status + ' ' + r.headers.get('content-type') + '\\n\\n' + (await r.text());
  } catch (e) { out.textContent = 'ERR ' + e.message; }
}));
</script></body></html>`;
}

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
    // 兼容带代理前缀的路径：取 /api/orbit/v1 之后（或原样）
    const raw = url.pathname;
    const path = raw.includes('/api/orbit/v1') ? raw.slice(raw.indexOf('/api/orbit/v1')) : raw;
    const method = req.method;
    const send = (code, body, headers = {}) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', ...headers }); res.end(body); };

    try {
      if (method === 'GET' && (path === '/' || path.endsWith('/index.html'))) {
        log('GET / -> html');
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        return res.end(indexHtml());
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
    console.log('[mock-gateway] 首页 /  ·  /health  ·  API 前缀 /api/orbit/v1');
  });
}
