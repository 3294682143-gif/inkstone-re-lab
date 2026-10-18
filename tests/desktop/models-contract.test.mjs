import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCapabilities, ModelContractError } from '../../src/desktop/models-contract.mjs';

const VALID = JSON.parse(readFileSync(new URL('../../fixtures/desktop/models.synthetic.json', import.meta.url), 'utf8'));

test('合法能力目录通过并规范化 answer_transport', () => {
  const caps = parseCapabilities(VALID);
  assert.equal(caps.protocol_version, '2.0');
  assert.equal(caps.models.length, 1);
  assert.equal(caps.models[0].answer_transport, 'strict_eof');
  assert.equal(caps.limits.max_messages, 100);
});

test('protocol_version 不兼容 → 抛错', () => {
  assert.throws(() => parseCapabilities({ ...VALID, protocol_version: '1' }), /incompatible/);
});

test('native_terminal_content 规范化为 strict_eof', () => {
  const v = JSON.parse(JSON.stringify(VALID));
  v.models[0].answer_transport = 'native_terminal_content';
  assert.equal(parseCapabilities(v).models[0].answer_transport, 'strict_eof');
});

test('空模型目录 → 抛错', () => {
  assert.throws(() => parseCapabilities({ ...VALID, models: [] }), /directory is invalid/);
});

test('max_output_tokens >= context_window → 抛错', () => {
  const v = JSON.parse(JSON.stringify(VALID));
  v.models[0].max_output_tokens = v.models[0].context_window;
  assert.throws(() => parseCapabilities(v), /token limits are invalid/);
});

test('supports_tools 非 true → 抛错', () => {
  const v = JSON.parse(JSON.stringify(VALID));
  v.models[0].supports_tools = false;
  assert.throws(() => parseCapabilities(v), /Model capability is invalid/);
});
