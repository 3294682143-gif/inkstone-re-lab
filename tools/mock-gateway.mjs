// tools/mock-gateway.mjs
// 本地离线 mock gateway：实现 inkstone-re-lab 已确认的桌面协议子集，使用**合成数据**。
// 仅用于本地/离线验收：不联网、无凭据、不启动 Electron/Windows。
//   node tools/mock-gateway.mjs [--port 8787] [--host 127.0.0.1]
// 也可被测试 import：createMockGatewayServer({...}) 返回 http.Server。
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
    req.on('end', () => { const s = Buffer.concat(chunks).toString('utf8'); try { resolve(s ? JSON.parse(s) : {}); } catch { resolve({ __parseError: true }); } });
  });
}
const envelope = (data) => JSON.stringify({ msg: 'ok', trace_id: 'synthetic-trace', code: 0, data });
const gsse = (events) => events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');

/**
 * @param {{syntheticMarker?:string, answerText?:string, withTool?:boolean, log?:Function}} opts
 * @returns {http.Server}
 */
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
    const path = url.pathname;
    const method = req.method;
    const send = (code, body, headers = {}) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', ...headers }); res.end(body); };

    try {
      if (method === 'POST' && path === '/api/orbit/v1/chat/new') {
        const id = ++chatSeq;
        log(`POST /chat/new -> id=${id}`);
        return send(200, envelope({ id }));
      }
      if (method === 'GET' && path === '/api/orbit/v1/local-agent/models') {
        log('GET /local-agent/models -> 200');
        return send(200, envelope(CAPABILITIES(marker)));
      }
      if (method === 'POST' && path === '/api/orbit/v1/local-agent/messages') {
        const body = await readBody(req);
        const chatId = body?.chat_id;
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
        log(`POST /local-agent/messages chat_id=${chatId} -> SSE (${events.length} events)`);
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

// CLI
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
  const host = arg('host', '127.0.0.1');
  const port = Number(arg('port', 8787));
  const server = createMockGatewayServer({ log: (m) => console.log('[mock-gateway] ' + m) });
  server.listen(port, host, () => {
    console.log(`[mock-gateway] listening on http://${host}:${port}/api/orbit/v1  (synthetic, offline)`);
    console.log('[mock-gateway] endpoints: POST /chat/new, GET /local-agent/models, POST /local-agent/messages, POST /chat/{id}/local-turns[/{turnId}/checkpoint|/complete]');
  });
}
