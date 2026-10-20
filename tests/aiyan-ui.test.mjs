// 自研前端「智衍 衡鉴」回归：
// 1) 页面可访问、品牌与三页签存在、**不引用官方域名或官方前端包**
// 2) /api/* 经自研服务反代到本地 mock，关键接口可用（含论文核验）
// 复用 tests/helpers-server.mjs，与 mock-gateway 测试同一起服务逻辑。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers-server.mjs';

async function startStack() {
  const mock = await startServer('tools/mock-gateway.mjs');
  const ui = await startServer('tools/aiyan-ui.mjs', {
    healthPath: '/chat',
    env: { MOCK_ORIGIN: mock.base },
  });
  return { mock, ui };
}

function stop(stack) {
  for (const s of [stack.ui, stack.mock]) {
    try { s.child.kill(); } catch { /* 已退出 */ }
  }
}

test('自研前端可访问，品牌与论文三页签就位，不引用官方资源', async () => {
  const stack = await startStack();
  try {
    const r = await fetch(stack.ui.base + '/chat');
    const html = await r.text();
    assert.equal(r.status, 200, '页面应 200');
    assert.ok(html.includes('智衍 衡鉴'), '应含品牌「智衍 衡鉴」');
    for (const tab of ['论文检索', '论文精读', '引文核验']) {
      assert.ok(html.includes(tab), '应含论文页签：' + tab);
    }
    assert.ok(!/intern-ai\.org\.cn|openxlab\.org\.cn|mock-cdn/.test(html), '页面不得引用官方域名或官方前端包');
    assert.ok(!/<script[^>]+src="https?:/.test(html), '不得有外链脚本');
  } finally {
    stop(stack);
  }
});

test('API 经自研服务反代可用：模型列表与论文核验', async () => {
  const stack = await startStack();
  try {
    const models = await (await fetch(stack.ui.base + '/api/orbit/v1/models')).json();
    assert.equal(models.code, 0, '模型列表 code=0');

    const checkRes = await fetch(stack.ui.base + '/api/nova/v1/paper/check', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '正文与参考文献片段', mode: 'exist' }),
    });
    const check = await checkRes.json();
    assert.equal(check.code, 0, '核验接口 code=0');
    assert.ok(check.data.stats.all >= 1, '核验应返回统计');
    assert.ok(Array.isArray(check.data.items) && check.data.items.length >= 1, '核验应返回条目');
  } finally {
    stop(stack);
  }
});

test('论文检索结果含文档要求的卡片字段', async () => {
  const stack = await startStack();
  try {
    const j = await (await fetch(stack.ui.base + '/api/nova/v1/search/works?query=crystal')).json();
    const list = j.data.list;
    assert.ok(list.length >= 1);
    for (const key of ['authors', 'abstract', 'tags', 'type', 'free_pdf']) {
      assert.ok(Object.prototype.hasOwnProperty.call(list[0], key), '卡片字段应含 ' + key);
    }
  } finally {
    stop(stack);
  }
});
