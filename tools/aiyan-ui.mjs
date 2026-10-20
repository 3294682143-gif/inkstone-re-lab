// 「智衍 衡鉴」自研前端本地服务。
// 页面为纯手写 HTML/CSS/JS（tools/aiyan-ui.html），不加载任何官方前端包；
// /api/* 一律转发到本地 mock 网关（默认 127.0.0.1:8787），不访问官方站点。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

function cliArg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const PORT = Number(cliArg('port', process.env.PORT || 8899));
const HOST = cliArg('host', process.env.HOST || '127.0.0.1');
const MOCK_ORIGIN = process.env.MOCK_ORIGIN || 'http://127.0.0.1:8787';
const HTML_PATH = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), 'aiyan-ui.html');

function html() {
  try {
    return fs.readFileSync(HTML_PATH, 'utf8');
  } catch (e) {
    return '<!doctype html><meta charset="utf-8"><h1>页面缺失</h1><p>tools/aiyan-ui.html 未找到</p>';
  }
}

async function proxy(req, res) {
  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const headers = Object.fromEntries(
      Object.entries(req.headers).filter(([k]) => !['host', 'connection', 'content-length'].includes(k))
    );
    const r = await fetch(MOCK_ORIGIN + req.url, { method: req.method, headers, body: body && body.length ? body : undefined });
    const out = Object.fromEntries([...r.headers].filter(([k]) => k !== 'content-length'));
    res.writeHead(r.status, out);
    res.end(Buffer.from(await r.arrayBuffer()));
  } catch (e) {
    res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ code: -1, message: '本地 mock 不可用: ' + e.message }));
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://' + HOST + ':' + PORT);
  if (url.pathname.startsWith('/api/')) return proxy(req, res);
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(html());
});

server.listen(PORT, HOST, () => {
  console.log('[aiyan-ui] http://' + HOST + ':' + PORT + '/chat  (自研前端 · api -> ' + MOCK_ORIGIN + ')');
});
