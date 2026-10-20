// 本地运行「真站前端」：静态资源按原 URL 路径提供，/api/* 转发到本地 mock 网关。
// 目的：像素级一致的界面 + 完全本地的后端（不连目标站 API）。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.resolve('02-sources/original');
const SHELL = path.join(SRC, 'real-shell');
const MOCK_ORIGIN = process.env.MOCK_ORIGIN || 'http://127.0.0.1:8787';
const PORT = Number(process.env.PORT || 8899);
const HOST = process.env.HOST || '127.0.0.1';

const INDEX_HTML = `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"/>
<link rel="icon" type="image/svg+xml" href="/images/intern-discovery-logo.4889763e.svg"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>书生·端砚 Intern InkStone（本地前端）</title>
<base href="/"/>
<script>(function(){var fix=function(u){try{var x=String(u);x=x.split("/chat/chat/").join("/chat/");var parts=x.split("/");if(parts.length===3&&parts[1]==="chat"&&parts[2]!==""&&String(Number(parts[2]))===parts[2]){return "/chat";}return x;}catch(e){return u}};var p=history.pushState,r=history.replaceState;history.pushState=function(a,b,c){return p.call(this,a,b,c===undefined?c:fix(c))};history.replaceState=function(a,b,c){return r.call(this,a,b,c===undefined?c:fix(c))};})();</script>
<script defer src="/js/vendors.1cb37f21.js"></script>
<script defer src="/js/main.63f27b75.js"></script>
<script defer src="/remoteEntry.js"></script>
<link href="/css/vendors.43717d3f.css" rel="stylesheet"/>
<link href="/css/597.efe435f3.chunk.css" rel="stylesheet"/>
</head><body><div id="root"></div></body></html>`;

// 捕获文件名 → URL 路径
// 捕获名里的 `_assets_` 还原成 URL 的 `assets/`
function fixAssetPath(rest) {
  return rest.replace(/^assets_/, 'assets/').replace(/_assets_/, '/assets/');
}

function buildMap() {
  const map = new Map();
  for (const f of fs.readdirSync(SRC)) {
    if (!f.endsWith('.js')) continue;
    // CDN 远程件：static.openxlab.org.cn/discovery-fe/prod/<app-fe>/<build>/<rest>
    let c = f.match(/^static\.openxlab\.org\.cn_discovery-fe_prod_discovery-moce-fe_[a-f0-9]+_(.+)$/);
    if (c) { map.set('/mock-cdn/moce/' + fixAssetPath(c[1]), path.join(SRC, f)); continue; }
    c = f.match(/^static\.openxlab\.org\.cn_discovery-fe_prod_discovery-app-fe_[a-f0-9]+_(.+)$/);
    if (c) { map.set('/mock-cdn/app-fe/' + fixAssetPath(c[1]), path.join(SRC, f)); continue; }
    // 旧采集命名（我的 fetch 脚本写过 static.openxlab.org.cn_moce_<name>）
    c = f.match(/^static\.openxlab\.org\.cn_moce_(.+)$/);
    if (c) { map.set('/mock-cdn/moce/assets/' + c[1], path.join(SRC, f)); continue; }
    let m = f.match(/^discovery\.intern_ai\.org\.cn_js_(.+)$/);
    if (m) { map.set('/js/' + m[1], path.join(SRC, f)); continue; }
    m = f.match(/^discovery\.intern_ai\.org\.cn_moce_(.+)$/);
    if (m) { map.set('/moce/' + m[1], path.join(SRC, f)); continue; }
    m = f.match(/^discovery\.intern_ai\.org\.cn_(remoteEntry.*\.js)$/);
    if (m) { map.set('/' + m[1], path.join(SRC, f)); continue; }
  }
  // MOCE 资产 → /mock-cdn/moce/assets/...
  const moceDir = path.join(SRC, 'real-shell', 'mock-cdn', 'moce', 'assets');
  for (const f of fs.readdirSync(SRC)) {
    const m = f.match(/^static\.openxlab\.org\.cn_moce_(.+)$/);
    if (m) map.set('/mock-cdn/moce/assets/' + m[1], path.join(SRC, f));
  }
  if (fs.existsSync(moceDir)) {
    for (const f of fs.readdirSync(moceDir)) map.set('/mock-cdn/moce/assets/' + f, path.join(moceDir, f));
  }
  // MOCE remoteEntry 本体
  const moceEntryCandidates = fs.readdirSync(SRC).filter(f => /^static\.openxlab\.org\.cn_moce_remoteEntry\.js$/.test(f));
  if (moceEntryCandidates.length) map.set('/mock-cdn/moce/remoteEntry.js', path.join(SRC, moceEntryCandidates[0]));
  // 真实壳的 css / images
  for (const sub of ['css', 'images']) {
    const d = path.join(SHELL, sub);
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d)) map.set('/' + sub + '/' + f, path.join(d, f));
  }
  return map;
}
const MAP = buildMap();

// 采集脚本会把连续下划线压成单个（safeName 的 /_+/g 替换），这里按压缩名建回退表
const collapse = (x) => x.replace(/_+/g, '_');
const COLLAPSED = new Map();
for (const [urlPath, file] of MAP) {
  const dir = path.posix.dirname(urlPath);
  const base = collapse(path.posix.basename(urlPath));
  const key = dir + '/' + base;
  if (!COLLAPSED.has(key)) COLLAPSED.set(key, file);
}
function resolveWithCollapse(urlPath) {
  const dir = path.posix.dirname(urlPath);
  const base = collapse(path.posix.basename(urlPath));
  return COLLAPSED.get(dir + '/' + base);
}

// 本地合成登录态：前端用 cookie uaa-token / ssouid 判定登录，getUserInfo 取用户信息
function synUid() { return 'local-user-0001'; }
function b64url(obj) { return Buffer.from(JSON.stringify(obj)).toString('base64url'); }
function synthJwt() {
  const header = b64url({ alg: 'HS256', typ: 'JWT' });
  const payload = b64url({
    sub: synUid(), uid: synUid(), ssoUid: synUid(), name: '本地用户',
    exp: Math.floor(Date.now() / 1000) + 86400 * 365, iat: Math.floor(Date.now() / 1000),
  });
  return header + '.' + payload + '.local-signature';
}
const SYNTH_USER = {
  ssoUid: synUid(), sso_uid: synUid(), uid: synUid(), userName: '本地用户', username: '本地用户',
  nickName: '本地用户', nickname: '本地用户', name: '本地用户', avatar: '', avatarUrl: '',
  email: 'local@example.invalid', phone: '', role: 'user', isLogin: true,
};
function synthAuthBody(urlPath) {
  if (urlPath.endsWith('/getUserInfo') || urlPath.endsWith('/users/auth') || urlPath.endsWith('/users/profile')) {
    return { code: 0, msg: 'success', message: 'success', data: SYNTH_USER };
  }
  return null;
}

const CDN_REWRITES = [
  ['https://static.openxlab.org.cn/discovery-fe/prod/discovery-moce-fe/3b8d2b32/', '/mock-cdn/moce/'],
  ['https://static.openxlab.org.cn/discovery-fe/prod/discovery-app-fe/4cbb6628/', '/mock-cdn/app-fe/'],
  ['https://discovery.intern-ai.org.cn/', '/'],
];
function rewrite(text) {
  let out = text;
  for (const [from, to] of CDN_REWRITES) out = out.split(from).join(to);
  return out;
}

function contentType(p) {
  const e = path.extname(p).toLowerCase();
  return ({ '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
    '.json': 'application/json; charset=utf-8', '.map': 'application/json; charset=utf-8' })[e] || 'application/octet-stream';
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://' + HOST + ':' + PORT);
  const p = decodeURIComponent(url.pathname);

  // 本地合成登录态：直接返回用户信息，不走进 mock
  const synth = synthAuthBody(p);
  if (synth) {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(synth));
    return;
  }

  // API 转发到本地 mock
  if (p.startsWith('/api/')) {
    try {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const r = await fetch(MOCK_ORIGIN + req.url, {
        method: req.method,
        headers: Object.fromEntries(Object.entries(req.headers).filter(([k]) => !['host', 'connection', 'content-length'].includes(k))),
        body: body && body.length ? body : undefined,
      });
      res.writeHead(r.status, Object.fromEntries([...r.headers].filter(([k]) => k !== 'content-length')));
      const buf = Buffer.from(await r.arrayBuffer());
      res.end(buf);
    } catch (e) {
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ code: -1, message: 'mock upstream failed: ' + e.message }));
    }
    return;
  }

  const file = MAP.get(p) || resolveWithCollapse(p);
  if (file && fs.existsSync(file)) {
    const buf = fs.readFileSync(file);
    const ct = contentType(file);
    if (/^(text\/javascript|text\/css)/.test(ct)) {
      res.writeHead(200, { 'content-type': ct });
      res.end(rewrite(buf.toString('utf8')));
    } else {
      res.writeHead(200, { 'content-type': ct });
      res.end(buf);
    }
    return;
  }

  // SPA 兜底（顺带写入本地合成登录 cookie）
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'set-cookie': [
      'uaa-token=' + synthJwt() + '; Path=/; SameSite=Lax',
      'ssouid=' + synUid() + '; Path=/; SameSite=Lax',
    ],
  });
  res.end(INDEX_HTML);
});

server.listen(PORT, HOST, () => {
  console.log('[real-shell] http://' + HOST + ':' + PORT + '  (static=' + MAP.size + ' files, api -> ' + MOCK_ORIGIN + ')');
});
