// 自研前端一键校验（npm run ui:verify）：
// 起 mock + 自研前端，检查页面/代理/关键接口，复用 tests/helpers-server.mjs。
import { startServer } from '../tests/helpers-server.mjs';

let failures = 0;
function ok(msg) { console.log('  ✔ ' + msg); }
function bad(msg) { console.error('  ✖ ' + msg); failures++; }

let stack;
try {
  const mock = await startServer('tools/mock-gateway.mjs');
  const ui = await startServer('tools/aiyan-ui.mjs', { healthPath: '/chat', env: { MOCK_ORIGIN: mock.base } });
  stack = { mock, ui };

  const html = await (await fetch(ui.base + '/chat')).text();
  if (html.includes('智衍 衡鉴')) ok('品牌「智衍 衡鉴」存在'); else bad('缺少品牌');
  for (const tab of ['论文检索', '论文精读', '引文核验']) {
    if (html.includes(tab)) ok('论文页签存在：' + tab); else bad('缺少页签：' + tab);
  }
  if (!/intern-ai\.org\.cn|openxlab\.org\.cn|mock-cdn/.test(html)) ok('页面无官方域名/包引用'); else bad('页面引用了官方资源');

  const models = await (await fetch(ui.base + '/api/orbit/v1/models')).json();
  if (models.code === 0) ok('API 反代可用（models code=0）'); else bad('API 反代失败');

  const check = await (await fetch(ui.base + '/api/nova/v1/paper/check', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: '片段', mode: 'exist' }),
  })).json();
  if (check.code === 0 && check.data && check.data.stats && check.data.stats.all >= 1) ok('论文核验接口可用'); else bad('论文核验接口异常');
} catch (e) {
  bad('执行异常：' + e.message);
} finally {
  if (stack) {
    try { stack.ui.child.kill(); } catch {}
    try { stack.mock.child.kill(); } catch {}
  }
}

if (failures) {
  console.error('ui:verify 未通过：' + failures + ' 项');
  process.exit(1);
}
console.log('ui:verify 通过');
