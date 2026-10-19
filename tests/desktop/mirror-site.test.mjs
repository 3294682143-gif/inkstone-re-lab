import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMirrorServer, rewriteHtml } from '../../tools/mirror-site.mjs';

test('rewriteHtml：主域同源化、外部域走 /__ext', () => {
  const html = '<script src="https://discovery.intern-ai.org.cn/js/main.js"></script><link href="https://static.openxlab.org.cn/x.css">';
  const out = rewriteHtml(html, 'https://discovery.intern-ai.org.cn');
  assert.match(out, /src="\/js\/main\.js"/);
  assert.match(out, /href="\/__ext\/static\.openxlab\.org\.cn\/x\.css"/);
});

test('mirror：/ 提供抓取到的前端页面（本地，无需网络）', async () => {
  const server = createMirrorServer({ origin: 'https://discovery.intern-ai.org.cn' });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /text\/html/);
    const t = await res.text();
    assert.ok(t.length > 1000);
  } finally { await new Promise((r) => server.close(r)); }
});
