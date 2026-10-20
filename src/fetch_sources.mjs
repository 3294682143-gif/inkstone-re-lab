// 从 A0 网络记录中提取 script 资源并下载到 02-sources/original，登记 URL/哈希/字节数。
// 仅获取页面正常加载所涉及的资源；不猜测、不越权。
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolveBrowserProxy } from './browser-lib.mjs';

const PROXY = resolveBrowserProxy(process.env);
import { ProxyAgent } from 'undici';

const net = JSON.parse(readFileSync('01-evidence/sanitized/a0-network.json', 'utf8'));
const urls = [...new Set(net.records.filter(r => r.kind === 'request' && r.rtype === 'script').map(r => r.url))]
  .filter(u => u.startsWith('http')); // 跳过 blob:

mkdirSync('02-sources/original', { recursive: true });
mkdirSync('02-sources/working', { recursive: true });

const manifest = [];
const dispatcher = PROXY ? new ProxyAgent(PROXY) : undefined;
const doFetch = fetch;

function safeName(u) {
  const x = new URL(u);
  return (x.host.replace(/[^a-z0-9.]+/gi, '_') + '__' + x.pathname.replace(/[^a-z0-9._-]+/gi, '_')).replace(/_+/g, '_').slice(-160);
}

for (const u of urls) {
  try {
    const res = await doFetch(u, { dispatcher });
    const buf = Buffer.from(await res.arrayBuffer());
    const name = safeName(u);
    writeFileSync(`02-sources/original/${name}`, buf);
    manifest.push({ url: u, file: `02-sources/original/${name}`, status: res.status,
      bytes: buf.length, sha256: createHash('sha256').update(buf).digest('hex'),
      contentType: res.headers.get('content-type') || '' });
    console.log(`OK  ${res.status} ${buf.length}  ${u}`);
  } catch (e) {
    manifest.push({ url: u, error: String(e.message).split('\n')[0] });
    console.log(`ERR ${u}  ${e.message}`);
  }
}
writeFileSync('02-sources/original/manifest.json', JSON.stringify(manifest, null, 2));
console.log(`\n总计 ${manifest.length} 个；失败 ${manifest.filter(m => m.error).length}`);
