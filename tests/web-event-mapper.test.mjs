// 网页端事件合并器的回归测试。
// 期望值来自 MOCE 聊天模块 xa(e,t) 的逆向结果（03-analysis/readable/xa-event-mapper.js）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyEvent, eventType, isTerminal, TERMINAL_EVENTS } from '../src/web/event-mapper.mjs';

test('终态集合与逆向一致（5 个）', () => {
  assert.deepEqual([...TERMINAL_EVENTS].sort(), ['close', 'done', 'error', 'message_end', 'workflow_finished']);
  assert.equal(isTerminal('workflow_finished'), true);
  assert.equal(isTerminal('message'), false);
});

test('eventType 兼容 event / type 两种字段', () => {
  assert.equal(eventType({ event: 'message' }), 'message');
  assert.equal(eventType({ type: 'message_end' }), 'message_end');
  assert.equal(eventType(null), '');
});

test('message 追加答案增量并解除等待', () => {
  const s = applyEvent({ assistantResponse: 'AB', isWaitingForMessage: true }, { event: 'message', answer: 'CD', mid: '77' });
  assert.equal(s.assistantResponse, 'ABCD');
  assert.equal(s.responseDelta, 'CD');
  assert.equal(s.isWaitingForMessage, false);
  assert.equal(s.messageId, 77);
});

test('thinking 增量走 text 字段', () => {
  const s = applyEvent({ thinking: 'x' }, { event: 'thinking', text: 'y' });
  assert.equal(s.thinking, 'xy');
  assert.equal(s.thinkingDelta, 'y');
});

test('message_end 置 done + answerEnded；workflow_finished 置 done', () => {
  const a = applyEvent({}, { event: 'message_end' });
  assert.equal(a.done, true);
  assert.equal(a.answerEnded, true);
  const b = applyEvent({}, { event: 'workflow_finished' });
  assert.equal(b.done, true);
  assert.equal(b.answerEnded, undefined);
});

test('error 写入错误文案并收尾', () => {
  const s = applyEvent({}, { event: 'error', msg: 'boom' });
  assert.equal(s.error, 'boom');
  assert.equal(s.isWaitingForMessage, false);
  assert.equal(s.hasMessageEnded, true);
  assert.equal(s.isAgentComplete, true);
});

test('followup 归一化为 followupActions', () => {
  const s = applyEvent({}, { event: 'followup', followup: [{ text: '继续追问', type: 'next' }, '纯字符串'] });
  assert.equal(s.followupActions.length, 2);
  assert.equal(s.followupActions[0].text, '继续追问');
  assert.equal(s.followupActions[0].type, 'next');
  assert.equal(s.followupActions[1].text, '纯字符串');
});

test('continue_actions 归一化为 continueActions', () => {
  const s = applyEvent({}, { event: 'message', continue_actions: [{ label: '重新生成', primary: true }] });
  assert.equal(s.continueActions.length, 1);
  assert.equal(s.continueActions[0].label, '重新生成');
  assert.equal(s.continueActions[0].primary, true);
});

test('agent_events 数组写入 agentEvents', () => {
  const s = applyEvent({}, { event: 'message', agent_events: [{ id: 'a' }] });
  assert.equal(Array.isArray(s.agentEvents), true);
  assert.equal(s.agentEvents.length, 1);
});

test('subagent 事件不产生主答案增量', () => {
  // 原式 a = type.includes("subagent")：只有事件类型带 subagent 时才抑制增量
  const s = applyEvent({ assistantResponse: '' }, { event: 'subagent.message', agent: { result: { id: 'sub' } }, answer: '不应出现' });
  assert.equal(s.responseDelta, undefined);
  assert.equal(s.assistantResponse, '');
});
