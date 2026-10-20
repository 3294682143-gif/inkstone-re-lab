// 逆向演示宿主（tools/mock-gateway.mjs）的回归测试：
// 1) 页面内联脚本必须能被解析（历史上两次因模板字符串转义写坏，页面整体不执行）
// 2) 各协议/子应用接口必须返回 code=0
// 3) 论文检索 POST 必须按 query 过滤
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { once } from 'node:events';

async function freePort() {
  const srv = net.createServer();
  srv.listen(0, '127.0.0.1');
  await once(srv, 'listening');
  const port = srv.address().port;
  srv.close();
  await once(srv, 'close');
  return port;
}

async function startGateway() {
  const port = await freePort();
  const child = spawn(process.execPath, ['tools/mock-gateway.mjs', '--port', String(port), '--host', '127.0.0.1'], {
    stdio: 'ignore', env: { ...process.env, ELECTRON_RUN_AS_NODE: '' },
  });
  const base = 'http://127.0.0.1:' + port;
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(base + '/health');
      if (r.ok) return { child, base };
    } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  child.kill();
  throw new Error('gateway did not start');
}

test('内联页面脚本语法有效', async () => {
  const { child, base } = await startGateway();
  try {
    const html = await (await fetch(base + '/')).text();
    const m = html.match(/<script>([\s\S]*?)<\/script>/);
    assert.ok(m, '页面应包含内联脚本');
    // 仅做语法校验，不执行
    assert.doesNotThrow(() => new Function(m[1]), '内联脚本必须语法有效');
    assert.ok(html.includes('data-route='), '侧栏应带路由标记');
    assert.ok(html.includes('id="view"'), '应存在视图容器');
  } finally { child.kill(); }
});

test('网页协议与子应用接口均返回 code=0', async () => {
  const { child, base } = await startGateway();
  try {
    const paths = [
      '/api/orbit/v1/models',
      '/api/scphub/v1/scp/tags',
      '/api/datasets/v1/category/list',
      '/api/datasets/v1/dataset/square_list',
      '/api/spacebe/v1/space/list',
      '/api/moce/v1/apps/list',
      '/api/ml/v1/dev-machine/list',
      '/api/ml/v1/cloud-disk/quota',
      '/api/tokenplan/v1/models',
      '/api/nova/v1/search/hot-papers',
    ];
    for (const p of paths) {
      const r = await fetch(base + p);
      assert.equal(r.status, 200, p + ' 状态码');
      const j = await r.json();
      assert.equal(j.code, 0, p + ' code');
      assert.ok(j.data, p + ' data 存在');
    }
  } finally { child.kill(); }
});

test('论文检索按 query 过滤（GET + params，源码语义）', async () => {
  const { child, base } = await startGateway();
  try {
    const r = await fetch(base + '/api/nova/v1/search/works?query=crystal');
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(j.code, 0);
    assert.ok(Array.isArray(j.data.list) && j.data.list.length >= 1);
    assert.ok(j.data.list.every(x => (x.title + ' ' + x.venue + ' ' + x.angle_name).toLowerCase().includes('crystal')), '结果应全部命中 query');
    // 形状与前端校验器一致（angle_name/query/count + total_count + reasoning_process）
    assert.equal(typeof j.data.reasoning_process, 'string');
    assert.equal(typeof j.data.total_count, 'number');
    for (const t of j.data.termList) {
      assert.equal(typeof t.angle_name, 'string');
      assert.equal(typeof t.query, 'string');
      assert.equal(typeof t.count, 'number');
    }
  } finally { child.kill(); }
});

test('thinking_mode 控制思维增量（A6 语义）', async () => {
  const { child, base } = await startGateway();
  try {
    const run = async (thinking) => {
      const r = await fetch(base + '/api/orbit/v1/chat', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scenario: 1, thinking_mode: thinking, model: 'Default', query: 'x', chat_id: 1 }),
      });
      const text = await r.text();
      const events = text.split('\n\n').map(b => b.trim()).filter(x => x.startsWith('data:')).map(x => JSON.parse(x.slice(5)));
      return events;
    };
    const deep = await run(true);
    assert.ok(deep.some(e => e.event === 'message' && typeof e.thinking === 'string'), '深度模式应出现 thinking 增量');
    assert.ok(deep.some(e => e.event === 'workflow_finished'), '应有 workflow_finished');
    const quick = await run(false);
    assert.ok(!quick.some(e => e.event === 'message' && typeof e.thinking === 'string'), '快速模式不应出现 thinking 增量');
    assert.ok(quick.some(e => e.event === 'message' && typeof e.answer === 'string'), '快速模式仍应有答案增量');
  } finally { child.kill(); }
});
