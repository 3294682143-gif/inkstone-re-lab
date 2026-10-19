import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockGatewayServer } from '../../tools/mock-gateway.mjs';
import { createCloudAdapter } from '../../src/desktop/cloud-adapter.mjs';

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

test('mock-gateway：本地离线闭环（新建→模型目录→推理→本地轮次同步）', async () => {
  const server = createMockGatewayServer({ answerText: 'OK', withTool: false });
  const port = await listen(server);
  const a = createCloudAdapter({ baseUrl: `http://127.0.0.1:${port}/api/orbit/v1`, authority: { token: 'x', ssoUid: 'u', locale: 'zh-CN' }, timeoutMs: 3000 });
  try {
    const id = await a.createConversation();
    assert.ok(Number.isSafeInteger(id) && id > 0);
    const caps = await a.getModels();
    assert.equal(caps.protocol_version, '2.0');
    assert.equal(caps.models.length, 1);
    const inf = await a.startInference({ inference_kind: 'turn', lifecycle_owner: 'turn', chat_id: id, turn_id: 't1', request_id: 'req1', model: 'synthetic-model-a', messages: [], tools: [] });
    assert.equal(inf.content, 'OK');
    assert.equal(inf.stopReason, 'end_turn');
    assert.equal(inf.usage.output_tokens, 2);
    const start = await a.conversationStart(id, { synthetic: true });
    assert.equal(start.status, 'running');
    const done = await a.conversationComplete(id, 'turn_syn_1', { synthetic: true });
    assert.equal(done.status, 'complete');
    assert.equal(done.turnId, 'turn_syn_1');
    assert.ok(server.requestCount.total >= 5);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('mock-gateway：工具链路（tool_use_* 合并）', async () => {
  const server = createMockGatewayServer({ answerText: 'DONE', withTool: true });
  const port = await listen(server);
  const a = createCloudAdapter({ baseUrl: `http://127.0.0.1:${port}/api/orbit/v1`, authority: { token: 'x', ssoUid: 'u', locale: 'zh-CN' }, timeoutMs: 3000 });
  try {
    const inf = await a.startInference({ chat_id: 1, model: 'synthetic-model-a', messages: [], tools: [] });
    assert.equal(inf.stopReason, 'tool_use');
    assert.equal(inf.tools.length, 1);
    assert.equal(inf.tools[0].name, 'echo');
    assert.deepEqual(inf.tools[0].input, { x: 1 });
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('mock-gateway：/health 与首页，以及带代理前缀的路径兼容', async () => {
  const server = createMockGatewayServer();
  const port = await listen(server);
  const root = `http://127.0.0.1:${port}`;
  try {
    const h = await (await fetch(`${root}/health`)).json();
    assert.equal(h.ok, true);
    assert.equal(h.synthetic, true);
    const home = await (await fetch(`${root}/`)).text();
    assert.match(home, /inkstone-re-lab/);
    assert.match(home, /SYNTHETIC/);
    // 带代理前缀的路径（模拟 ModelArts /proxy/<port>/ 前缀）
    const prefixed = await (await fetch(`${root}/520b33f3-e7d5-4f62-833a-c550ecf612d1/proxy/8787/api/orbit/v1/local-agent/models`)).json();
    assert.equal(prefixed.data.protocol_version, '2.0');
  } finally {
    await new Promise((r) => server.close(r));
  }
});
