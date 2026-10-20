// tools/mirror-site.mjs
// 原站前端本地镜像：把抓取到的聊天前端页面与其静态资源通过本地地址提供，
// 以便在浏览器查看“逆向出来的前端页面”。资源经服务器代理到原站（只读 GET）。
//   node tools/mirror-site.mjs [--port 8788] [--host 0.0.0.0] [--origin https://discovery.intern-ai.org.cn]
// 说明：仅镜像前端页面/静态资源；页面内的业务接口仍需原站登录态，浏览器侧可能是未登录界面。
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { ProxyAgent } from 'undici';

const DEFAULT_ORIGIN = 'https://discovery.intern-ai.org.cn';
const EXT_HOSTS = ['static.openxlab.org.cn', 'aurora.openxlab.org.cn', 'openxlab.org.cn', 'at.alicdn.com', 'sensorsdata.intern-ai.org.cn'];
const CAPTURED = '01-evidence/sanitized/a0-page.html';

export function rewriteHtml(html, origin) {
  let out = html.replaceAll(origin, '');                 // 主域 → 同源（走本地代理）
  for (const h of EXT_HOSTS) out = out.replaceAll(`https://${h}`, `/__ext/${h}`);
  return out;
}

export function createMirrorServer({ origin = DEFAULT_ORIGIN, proxy = process.env.HTTPS_PROXY || process.env.https_proxy || null, snapshot = true, bearer = process.env.INKSTONE_WEB_TOKEN || null, log = () => {} } = {}) {
  const dispatcher = proxy ? new ProxyAgent(proxy) : undefined;
  const get = async (url) => {
    const opts = { redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 (mirror)', 'accept': '*/*' } };
    if (dispatcher) opts.dispatcher = dispatcher;
    return fetch(url, opts);
  };

  // 通用上游请求：保留方法/请求体/鉴权；bearer 来自 INKSTONE_WEB_TOKEN（不落盘、不写日志）
  const upstream = async (url, method, body, contentType) => {
    const headers = { 'user-agent': 'Mozilla/5.0 (mirror)', accept: '*/*' };
    if (contentType) headers['content-type'] = contentType;
    if (bearer) headers.authorization = 'Bearer ' + bearer;
    const opts = { method, headers, redirect: 'follow' };
    if (body && body.length) opts.body = body;
    if (dispatcher) opts.dispatcher = dispatcher;
    return fetch(url, opts);
  };

  const server = http.createServer(async (req, res) => {
    const ALLOWED = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']);
    if (!ALLOWED.has(req.method)) { res.writeHead(405); return res.end('method not allowed'); }
    const u = new URL(req.url, 'http://localhost');
    let path = u.pathname;
    try {
      // 首页：默认代理原站当前外壳（渲染结果与目标一致）；--snapshot 时改用抓取快照
      if (path === '/' || path === '' || path === '/chat/' || path === '/chat') {
        if (snapshot && existsSync(CAPTURED)) {
          const html = rewriteHtml(readFileSync(CAPTURED, 'utf8'), origin);
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          log('GET / -> captured a0-page.html (rewritten)');
          return res.end(html);
        }
        path = '/chat/';
      }
      let target;
      if (path.startsWith('/__ext/')) {
        const rest = path.slice('/__ext/'.length);
        const i = rest.indexOf('/');
        const host = i >= 0 ? rest.slice(0, i) : rest;
        const p = i >= 0 ? rest.slice(i) : '/';
        target = `https://${host}${p}${u.search}`;
      } else {
        target = `${origin}${path}${u.search}`;
      }
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const bodyBuf = Buffer.concat(chunks);
      const r = await upstream(target, req.method, req.method === 'GET' || req.method === 'HEAD' ? null : bodyBuf, req.headers['content-type']);
      const ct = r.headers.get('content-type') || 'application/octet-stream';
      let body = Buffer.from(await r.arrayBuffer());
      if (/text\/html/i.test(ct)) body = Buffer.from(rewriteHtml(body.toString('utf8'), origin));
      const headers = { 'content-type': ct, 'cache-control': 'no-store' };
      log(`${req.method} ${path} -> ${r.status} (${ct})`);
      res.writeHead(r.status, headers);
      return res.end(req.method === 'HEAD' ? undefined : body);
    } catch (e) {
      log(`${req.method} ${path} -> 502 ${String(e.message).slice(0, 80)}`);
      res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('mirror upstream error: ' + String(e.message).slice(0, 200));
    }
  });
  return server;
}

// Windows: 不能用 `file://${process.argv[1]}` 直接拼（盘符路径无法构成合法 file URL）
const __isMain = (() => { try { return !!process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url; } catch { return false; } })();
if (__isMain) {
  const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
  const host = arg('host', '0.0.0.0');
  const port = Number(arg('port', 8788));
  const origin = arg('origin', DEFAULT_ORIGIN);
  const snapshot = !process.argv.includes('--live-shell');
  const server = createMirrorServer({ origin, snapshot, log: (m) => console.log('[mirror] ' + m) });
  console.log('[mirror] mode=' + (snapshot ? 'snapshot(a0-page.html 默认)' : 'live-shell(proxy origin, --live-shell)'));
  server.listen(port, host, () => console.log(`[mirror] listening on http://${host}:${port}/  (origin=${origin})`));
}
