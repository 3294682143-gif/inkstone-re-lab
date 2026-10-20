// 自研前端护栏：确认页面与服务完全本地，不引用官方域名或官方前端包。
// 用法：node tools/check-self-ui.mjs（通过 0，违规 1）
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('.');
const targets = ['tools/aiyan-ui.html', 'tools/aiyan-ui.mjs'];
const bannedDomains = [
  'discovery.intern-ai.org.cn',
  'static.openxlab.org.cn',
  'openxlab.org.cn',
  'intern-ai.org.cn',
];
const bannedTraces = ['/mock-cdn/', 'remoteEntry', 'paper-static', 'compute-static', 'discovery-'];

let failures = 0;
const fail = (m) => {
  console.error('  [FAIL] ' + m);
  failures++;
};

for (const rel of targets) {
  const p = path.join(root, rel);
  if (!fs.existsSync(p)) {
    fail(rel + ' 不存在');
    continue;
  }
  const text = fs.readFileSync(p, 'utf8');
  if (text.length < 500) fail(rel + ' 内容过短，疑似占位');
  for (const d of bannedDomains) {
    if (text.includes(d)) fail(rel + ' 含官方域名/包: ' + d);
  }
  for (const t of bannedTraces) {
    if (text.includes(t)) fail(rel + ' 含官方前端包痕迹: ' + t);
  }
}

const htmlPath = path.join(root, 'tools/aiyan-ui.html');
if (fs.existsSync(htmlPath)) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  if (!html.includes('智衍 衡鉴')) fail('未包含品牌「智衍 衡鉴」');
  const srcs = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/g)].map((m) => m[1]);
  const external = srcs.filter((s) => /^https?:|^\/\//.test(s));
  if (external.length) fail('存在外部脚本引用: ' + external.join(', '));
  if (srcs.length) fail('不应有外链脚本（本页应为单文件内联）: ' + srcs.length + ' 个');
}

if (failures) {
  console.error('自研前端检查未通过：' + failures + ' 项');
  process.exit(1);
}
console.log('自研前端检查通过：纯本地、无官方引用、品牌已就位');
