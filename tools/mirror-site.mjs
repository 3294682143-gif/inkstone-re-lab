// tools/mirror-site.mjs
// 原站前端本地镜像：把抓取到的聊天前端页面与其静态资源通过本地地址提供，
// 以便在浏览器查看“逆向出来的前端页面”。资源经服务器代理到原站（只读 GET）。
//   node tools/mirror-site.mjs [--port 8788] [--host 0.0.0.0] [--origin https://discovery.intern-ai.org.cn]
// 说明：仅镜像前端页面/静态资源；页面内的业务接口仍需原站登录态，浏览器侧可能是未登录界面。
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { ProxyAgent } from 'undici';

const DEFAULT_ORIGIN = 'https://discovery.intern-ai.org.cn';
const EXT_HOSTS = ['static.openxlab.org.cn', 'aurora.openxlab.org.cn', 'openxlab.org.cn', 'at.alicdn.com', 'sensorsdata.intern-ai.org.cn'];
const CAPTURED = '01-evidence/sanitized/a0-page.html';

export function rewriteHtml(html, origin) {
  let out = html.replaceAll(origin, '');                 // 主域 → 同源（走本地代理）
  for (const h of EXT_HOSTS) out = out.replaceAll(`https://${h}`, `/__ext/${h}`);
  return out;
}

export function createMirrorServer({ origin = DEFAULT_ORIGIN, proxy = process.env.HTTPS_PROXY || process.env.https_proxy || null, log = () => {} } = {}) {
  const dispatcher = proxy ? new ProxyAgent(proxy) : undefined;
  const get = async (url) => {
    const opts = { redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 (mirror)', 'accept': '*/*' } };
    if (dispatcher) opts.dispatcher = dispatcher;
    return fetch(url, opts);
  };

  const server = http.createServer(async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end('method not allowed'); }
    const u = new URL(req.url, 'http://localhost');
    let path = u.pathname;
    try {
      // 首页：优先用抓取到的页面；否则代理原站 /chat/
      if (path === '/' || path === '' || path === '/chat/' || path === '/chat') {
        if (existsSync(CAPTURED)) {
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
      const r = await get(target);
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

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
  const host = arg('host', '0.0.0.0');
  const port = Number(arg('port', 8788));
  const origin = arg('origin', DEFAULT_ORIGIN);
  const server = createMirrorServer({ origin, log: (m) => console.log('[mirror] ' + m) });
  server.listen(port, host, () => console.log(`[mirror] listening on http://${host}:${port}/  (origin=${origin})`));
}
