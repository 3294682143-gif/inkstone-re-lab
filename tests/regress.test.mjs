// 回归脚本离线测试：依赖注入，不访问真实站点。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../src/regress.mjs';
import { countingFetch, readAuthFake, sseResponse, jsonResponse, sseFromEvents, completeEvents } from './helpers.mjs';

const NULL_ENV = {};
function cap() { const lines = []; return { out: (s) => lines.push(String(s)), err: (s) => lines.push(String(s)), lines }; }
const OUT = () => join(mkdtempSync(join(tmpdir(), 'inkstone-reg-')), 'regression.json');

/** 正常的三组×两轮 handler。 */
function okHandler({ ids = [9001, 9002, 9003], breakGroup = 0, dropMarker = 0 } = {}) {
  const map = new Map(); let ni = 0;
  return (url, opts) => {
    if (url.endsWith('/api/orbit/v1/chat/new')) {
      ni += 1;
      if (breakGroup && ni === breakGroup) return jsonResponse({ code: -1 });
      return jsonResponse({ code: 0, data: { id: ids[ni - 1] } });
    }
    if (url.endsWith('/api/orbit/v1/chat')) {
      const body = JSON.parse(opts.body);
      const chatId = body.chat_id;
      if (body.query.includes('复述')) {
        const mark = map.get(chatId) || 'NONE';
        const answer = dropMarker ? '我不知道' : `您上一条消息的测试标记是：${mark}。`;
        return sseResponse([sseFromEvents(completeEvents({ cid: chatId, answer }))]);
      }
      const mark = String(body.query).split('：')[0];
      map.set(chatId, mark);
      return sseResponse([sseFromEvents(completeEvents({ cid: chatId, answer: 'OK' }))]);
    }
    throw new Error('未知 URL ' + url);
  };
}

test('n 为 0 / 负数 / 非整数 / 无效字符串：退出码 2 且不联网、不读凭据', async () => {
  for (const v of ['0', '-1', '1.5', 'abc']) {
    let readAuthCalled = false;
    const fetchImpl = countingFetch(() => { throw new Error('不应联网'); });
    const c = cap();
    const code = await run(['--n', v], {
      env: NULL_ENV, stdout: c.out, stderr: c.err, fetchImpl,
      readAuth: () => { readAuthCalled = true; throw new Error('不应读取凭据'); },
    });
    assert.equal(code, 2, `n=${v}`);
    assert.equal(fetchImpl.count(), 0, `n=${v} 不应联网`);
    assert.equal(readAuthCalled, false, `n=${v} 不应读凭据`);
  }
});

test('三组不同会话、每组两轮全部正确：整体通过，退出码 0', async () => {
  const fetchImpl = countingFetch(okHandler());
  const c = cap();
  const code = await run(['--n', '3', '--out', OUT()], { env: NULL_ENV, stdout: c.out, stderr: c.err, fetchImpl, readAuth: readAuthFake, sleep: () => {} });
  assert.equal(code, 0);
  const joined = c.lines.join('\n');
  assert.match(joined, /"allOk": true/);
  assert.match(joined, /"distinctSessionIds": true/);
  // 3 组 × (chat/new + 2 send) = 9 次请求
  assert.equal(fetchImpl.count(), 9);
});

test('回归追问标记不匹配：allOk=false，退出码非零', async () => {
  const fetchImpl = countingFetch(okHandler({ dropMarker: 1 }));
  const c = cap();
  const code = await run(['--n', '3', '--out', OUT()], { env: NULL_ENV, stdout: c.out, stderr: c.err, fetchImpl, readAuth: readAuthFake, sleep: () => {} });
  assert.notEqual(code, 0);
  assert.match(c.lines.join('\n'), /"allOk": false/);
  assert.match(c.lines.join('\n'), /追问未包含本轮标记/);
});

test('任一组失败（chat/new 业务错误）：整体失败，退出码非零，且不发送该组追问', async () => {
  const fetchImpl = countingFetch(okHandler({ breakGroup: 2 }));
  const c = cap();
  const code = await run(['--n', '3', '--out', OUT()], { env: NULL_ENV, stdout: c.out, stderr: c.err, fetchImpl, readAuth: readAuthFake, sleep: () => {} });
  assert.notEqual(code, 0);
  assert.match(c.lines.join('\n'), /"allOk": false/);
  // 组1: new+2send=3；组2: new(失败)=1；组3: new+2send=3 => 7
  assert.equal(fetchImpl.count(), 7);
});

test('会话 ID 重复 → distinctSessionIds=false，整体失败', async () => {
  const fetchImpl = countingFetch(okHandler({ ids: [9100, 9100, 9100] }));
  const c = cap();
  const code = await run(['--n', '3', '--out', OUT()], { env: NULL_ENV, stdout: c.out, stderr: c.err, fetchImpl, readAuth: readAuthFake, sleep: () => {} });
  assert.notEqual(code, 0);
  assert.match(c.lines.join('\n'), /"distinctSessionIds": false/);
});

test('--n 缺值时（--n 后接 --out）：按缺值报错，退出码 2', async () => {
  const fetchImpl = countingFetch(() => { throw new Error('不应联网'); });
  const c = cap();
  const code = await run(['--n', '--out', OUT()], { env: NULL_ENV, stdout: c.out, stderr: c.err, fetchImpl, readAuth: readAuthFake });
  assert.equal(code, 2);
  assert.equal(fetchImpl.count(), 0);
});

test('P6.1-B 证据写入失败：即使全部会话成功，也必须非零退出', async () => {
  const fetchImpl = countingFetch(okHandler());
  const c = cap();
  const code = await run(['--n', '3', '--out', OUT()], {
    env: NULL_ENV, stdout: c.out, stderr: c.err, fetchImpl, readAuth: readAuthFake, sleep: () => {},
    writeFile: () => { throw new Error('EACCES: 无写入权限'); },
  });
  assert.notEqual(code, 0, '写入失败不得返回 0');
  const joined = c.lines.join('\n');
  assert.match(joined, /"allOk": true/);            // 请求层面确实全部成功
  assert.match(joined, /"evidenceWritten": false/); // 但证据未落盘
  assert.match(joined, /写入结果失败/);
});
