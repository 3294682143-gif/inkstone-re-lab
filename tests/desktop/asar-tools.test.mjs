import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const INSPECT = join(ROOT, 'tools/inspect_inkstone_asar.py');
const COMPARE = join(ROOT, 'tools/compare_asar_manifest.py');
const sha = (b) => createHash('sha256').update(b).digest('hex');

/** 构造最小合成 ASAR（含 out/ 与根 package.json），符合 inspect 脚本的头校验。 */
function buildAsar() {
  const entries = [
    ['out/main/x.js', Buffer.from('console.log(1)\n', 'utf8')],
    ['package.json', Buffer.from('{"name":"synthetic"}', 'utf8')],
  ];
  const files = {};
  let base = 0;
  for (const [path, buf] of entries) {
    const parts = path.split('/');
    let node = files;
    for (let i = 0; i < parts.length - 1; i++) { node[parts[i]] ??= { files: {} }; node = node[parts[i]].files; }
    node[parts[parts.length - 1]] = { size: buf.length, offset: base, integrity: { algorithm: 'SHA256', hash: sha(buf), blockSize: 4096, blocks: [sha(buf)] } };
    base += buf.length;
  }
  const json = Buffer.from(JSON.stringify({ files }), 'utf8');
  const json_size = json.length;
  const header_size = json_size + 8;
  const payload_size = header_size - 4;
  const prelude = Buffer.alloc(16);
  prelude.writeUInt32LE(4, 0); prelude.writeUInt32LE(header_size, 4); prelude.writeUInt32LE(payload_size, 8); prelude.writeUInt32LE(json_size, 12);
  // 数据紧跟在 json 之后；base = 8 + header_size = 16 + json_size，与脚本一致（无额外 padding）
  return Buffer.concat([prelude, json, ...entries.map(([, b]) => b)]);
}

const dir = mkdtempSync(join(tmpdir(), 'inkstone-asar-'));
const asar = join(dir, 'synthetic.asar');
writeFileSync(asar, buildAsar());
const run = (args) => { try { return { code: 0, out: execFileSync('python3', args, { encoding: 'utf8' }) }; } catch (e) { return { code: e.status ?? 1, out: String(e.stdout || ''), err: String(e.stderr || '') }; } };

test('inspect：全新 out/manifest 提取成功（合成 fixture）', () => {
  const man = join(dir, 'man-a.json');
  const r = run([INSPECT, '--asar', asar, '--out', join(dir, 'out-a'), '--manifest', man]);
  assert.equal(r.code, 0, r.err || r.out);
  const j = JSON.parse(readFileSync(man, 'utf8'));
  assert.equal(j.extracted_count, 2);
  assert.equal(j.executed_application_code, false);
});

test('inspect：拒绝覆盖已存在的 out 或 manifest（保护旧证据）', () => {
  const r1 = run([INSPECT, '--asar', asar, '--out', join(dir, 'out-a'), '--manifest', join(dir, 'man-x.json')]);
  assert.notEqual(r1.code, 0);                          // out 已存在
  mkdirSync(join(dir, 'out-b'), { recursive: true });
  const r2 = run([INSPECT, '--asar', asar, '--out', join(dir, 'out-b'), '--manifest', join(dir, 'man-a.json')]);
  assert.notEqual(r2.code, 0);                          // manifest 已存在
});

test('compare：一致 → 退出 0', () => {
  const a = join(dir, 'man-a.json');
  const b = join(dir, 'man-b.json');
  copyFileSync(a, b);
  const r = run([COMPARE, '--baseline', a, '--candidate', b]);
  assert.equal(r.code, 0, r.err || r.out);
  assert.match(r.out, /matches baseline/);
});

test('compare：内容不一致 → 非零并输出可定位差异', () => {
  const a = join(dir, 'man-a.json');
  const bad = JSON.parse(readFileSync(a, 'utf8'));
  bad.files[0].size += 1;                                // 制造内容差异
  bad.files[0].sha256 = 'deadbeef';
  const c = join(dir, 'man-bad.json');
  writeFileSync(c, JSON.stringify(bad, null, 2));
  const r = run([COMPARE, '--baseline', a, '--candidate', c]);
  assert.notEqual(r.code, 0);
  assert.match(r.err, /MANIFEST MISMATCH/);
  assert.match(r.err, /out\/main\/x\.js/);
});
