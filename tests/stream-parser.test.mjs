// P4 离线测试：解析真实脱敏样本（fixtures/*.sse.txt），断言分块/中文/增量/结束/未知。
// 运行: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SSEFrameParser, ChatStreamMerger, parseAll } from '../src/stream-parser.mjs';
import { buildChatSendBody, buildChatNewBody } from '../src/build-chat-request.mjs';

const A1 = readFileSync(new URL('../fixtures/a1.sse.txt', import.meta.url));
const A2 = readFileSync(new URL('../fixtures/a2.sse.txt', import.meta.url));

function mergeAll(events) { return new ChatStreamMerger().applyAll(events); }
function feedChunks(buf, size) {
  const p = new SSEFrameParser(); const out = [];
  for (let i = 0; i < buf.length; i += size) out.push(...p.push(buf.subarray(i, i + size)));
  out.push(...p.flush());
  return out;
}

test('整块解析：14 事件 + 事件序列 + answer 合并为 OK', () => {
  const evs = parseAll(A1.toString('utf8'));
  assert.equal(evs.length, 14);
  assert.equal(evs[0].type, 'workflow_started');
  assert.equal(evs.at(-1).type, 'workflow_finished');
  const m = mergeAll(evs);
  assert.equal(m.answer, 'OK');
  assert.equal(m.finished, true);
  assert.match(m.thinking, /用户/);
});

test('逐字节分块：与整块结果一致（含中文跨块）', () => {
  const evs = feedChunks(A1, 1);
  assert.equal(evs.length, 14);
  const m = mergeAll(evs);
  assert.equal(m.answer, 'OK');
  assert.equal(m.finished, true);
});

test('任意字节边界分块（3 块，切在中文中间）', () => {
  const n = A1.length;
  const cuts = [Math.floor(n * 0.33), Math.floor(n * 0.66)];
  const chunks = [A1.subarray(0, cuts[0]), A1.subarray(cuts[0], cuts[1]), A1.subarray(cuts[1])];
  const p = new SSEFrameParser(); const out = [];
  for (const c of chunks) out.push(...p.push(c));
  out.push(...p.flush());
  const m = mergeAll(out);
  assert.equal(m.answer, 'OK');
  assert.equal(m.finished, true);
});

test('一个读取块含多个事件', () => {
  const evs = feedChunks(A1, A1.length); // 单块
  assert.equal(evs.length, 14);
});

test('中文多字节跨块不产生乱码', () => {
  // 取含中文的片段，按 1 字节喂，检查 thinking 拼接正确
  const m = mergeAll(feedChunks(A1, 2));
  assert.ok(m.thinking.includes('用户'));
  assert.ok(!m.thinking.includes('ï¿½') && !m.thinking.includes('\uFFFD'));
});

test('未知事件类型不破坏既有状态', () => {
  const p = new SSEFrameParser();
  const evs = [
    ...p.push('data: {"event":"workflow_started","cid":"SESSION_A","mid":"MSG_1"}\n\n'),
    ...p.push('data: {"event":"weird_type","cid":"SESSION_A","mid":"MSG_1","foo":1}\n\n'),
    ...p.push('data: {"cid":"SESSION_A","event":"message","mid":"MSG_1","answer":"OK"}\n\n'),
    ...p.push('data: {"event":"workflow_finished","cid":"SESSION_A","mid":"MSG_1"}\n\n'),
    ...p.flush(),
  ];
  const m = mergeAll(evs);
  assert.equal(m.answer, 'OK');
  assert.equal(m.finished, true);
  assert.equal(m.unknown.length, 1);
  assert.equal(m.unknown[0].type, 'weird_type');
});

test('结束以 workflow_finished 表示（不依赖 [DONE]）', () => {
  const m = mergeAll(feedChunks(A1, 5));
  assert.equal(m.finished, true);
  // 显式 [DONE] 帧仅被安全忽略，不作为结束依据
  const p = new SSEFrameParser();
  const evs = [...p.push('data: [DONE]\n\n'), ...p.flush()];
  assert.equal(evs[0].type, 'done');
});

test('A2 追问样本：answer 含复述标记', () => {
  const m = mergeAll(feedChunks(A2, 3));
  assert.match(m.answer, /INKSTONE-RE-A1/);
  assert.equal(m.finished, true);
  assert.ok(m.followups.length >= 1);
});

test('请求构造：字段与实测一致', () => {
  const body = buildChatSendBody({ chatId: 1018682, query: 'hi', model: 'm', thinkingMode: true });
  assert.deepEqual(Object.keys(body).sort(),
    ['chat_id', 'model', 'planning_mode', 'query', 'scenario', 'thinking_mode'].sort());
  assert.equal(body.chat_id, 1018682);
  assert.equal(body.scenario, 1);
  assert.deepEqual(buildChatNewBody({}), { scenario: 1 });
});

test('请求构造：缺 chat_id/query 必须报错（禁止复用固定 ID）', () => {
  assert.throws(() => buildChatSendBody({ query: 'x' }), /chat_id/);
  assert.throws(() => buildChatSendBody({ chatId: 1 }), /query/);
});
