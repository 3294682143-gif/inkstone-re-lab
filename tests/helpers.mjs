// 测试辅助：构造 Response-like 与可计数的 fetchImpl；不访问真实网络。
const enc = new TextEncoder();

export function sseResponse(chunks, { status = 200, contentType = 'text/event-stream' } = {}) {
  const stream = new ReadableStream({
    start(c) { for (const ch of chunks) c.enqueue(typeof ch === 'string' ? enc.encode(ch) : ch); c.close(); },
  });
  return new Response(stream, { status, headers: { 'content-type': contentType } });
}

export function jsonResponse(obj, { status = 200, contentType = 'application/json; charset=utf-8' } = {}) {
  return new Response(JSON.stringify(obj), { status, headers: { 'content-type': contentType } });
}

export function htmlResponse(body, { status = 200 } = {}) {
  return new Response(body, { status, headers: { 'content-type': 'text/html' } });
}

export function countingFetch(handler) {
  const calls = [];
  const fn = async (url, opts) => { calls.push({ url, opts }); return handler(url, opts, calls.length); };
  fn.calls = calls;
  fn.count = () => calls.length;
  return fn;
}

export const FAKE_AUTH = { cookie: 'uaa-token=FAKE; ssouid=FAKE', token: 'FAKE.TOKEN.VALUE' };
export const readAuthFake = () => FAKE_AUTH;

/** 把事件对象数组序列化为 SSE 帧文本。 */
export function sseFromEvents(events) {
  return events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('');
}

/** 一组“完整正常结束”的对话事件（含增量 answer）。 */
export function completeEvents({ cid = 1, mid = 100, answer = 'OK' } = {}) {
  const events = [
    { event: 'workflow_started', cid, mid },
    ...[...answer].map((ch, i) => ({ event: 'message', cid, mid, answer: ch, thinking: '' })),
    { event: 'message_end', cid, mid },
    { event: 'followup', cid, mid, followup: [] },
    { event: 'workflow_finished', cid, mid },
  ];
  return events;
}

/** 缺 workflow_finished 的“不完整”事件。 */
export function incompleteEvents({ cid = 1, mid = 100, answer = 'OK' } = {}) {
  return completeEvents({ cid, mid, answer }).filter(e => e.event !== 'workflow_finished');
}
