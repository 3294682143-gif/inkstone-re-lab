#!/usr/bin/env node
// client.mjs — Intern InkStone 聊天最小客户端（P5）。
// 仅使用实测接口与鉴权类别：Cookie(uaa-token/ssouid/acw_tc) 从本地 storageState 读取。
// 默认不联网；--live 才发真实请求。凭证只从本地文件读取，不写入代码/日志。
//
// 用法:
//   node src/client.mjs --help
//   node src/client.mjs --dry-run --fixture fixtures/first-turn.json
//   node src/client.mjs --live --scenario new-conversation --text "INKSTONE-RE-LIVE-01：请只回复 OK。" --storage-state 01-evidence/private/inkstone-auth.json
//   node src/client.mjs --live --scenario follow-up --conversation-id <id> --text "请复述我上一条消息中的测试标记。" --storage-state ...
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { SSEFrameParser, ChatStreamMerger } from './stream-parser.mjs';
import { buildChatSendBody, buildChatNewBody, CHAT_SEND_PATH, CHAT_NEW_PATH } from './build-chat-request.mjs';

const _req = createRequire('/home/ma-user/.dsh/profiles/web/package.json');
const { ProxyAgent } = await import(_req.resolve('undici'));
const PROXY = process.env.HTTPS_PROXY || process.env.https_proxy || 'http://127.0.0.1:9999';
const BASE = 'https://discovery.intern-ai.org.cn';

function arg(n, d=undefined){ const i=process.argv.indexOf(`--${n}`); return i>=0?(process.argv[i+1]??true):d; }
const HELP = !!arg('help', false);
const DRY = !!arg('dry-run', false);
const LIVE = !!arg('live', false);
const SCEN = arg('scenario', 'new-conversation');
const TEXT = arg('text', null);
const CONV = arg('conversation-id', null);
const FIXTURE = arg('fixture', null);
const STORAGE = arg('storage-state', '01-evidence/private/inkstone-auth.json');

if (HELP) {
  console.log(`Intern InkStone 最小客户端
用法: node src/client.mjs [--dry-run|--live] [选项]

  --help                     显示本帮助
  --dry-run                  仅本地检查，绝不发送网络请求（默认行为）
  --fixture <path>           读取本地脱敏样本作为一次响应
  --live                     显式启用真实网络调用
  --scenario new-conversation 正常创建一个新会话并发第一条消息
  --scenario follow-up        在上一次真实返回的会话下追问
  --conversation-id <id>     追问时指定上一轮真实返回的会话 id
  --text <text>              本轮用户文本
  --storage-state <path>     本地登录态文件（cookies），默认 01-evidence/private/inkstone-auth.json

鉴权: Cookie(uaa-token/ssouid/acw_tc) 从 storageState 读取，不写入源码/日志。
结束语义: SSE 的 workflow_finished（不使用 [DONE]）。`);
  process.exit(0);
}

function readAuth(path) {
  if (!existsSync(path)) throw new Error(`storage-state 不存在: ${path}`);
  const d = JSON.parse(readFileSync(path, 'utf8'));
  const host = 'discovery.intern-ai.org.cn';
  const jar = (d.cookies || []).filter(c => host.endsWith(c.domain.replace(/^\./, '')) || c.domain.includes('openxlab'));
  const cookie = jar.map(c => `${c.name}=${c.value}`).join('; ');
  const tk = (d.cookies || []).find(c => c.name === 'uaa-token')?.value;
  if (!tk) throw new Error('storage-state 缺少 uaa-token（无法构造 Authorization）');
  return { cookie, token: tk };
}
const headers = (auth) => ({ 'content-type': 'application/json', 'accept': 'text/event-stream, application/json',
  'origin': BASE, 'referer': BASE + '/chat/', 'cookie': auth.cookie, 'authorization': 'Bearer ' + auth.token,
  'user-agent': 'Mozilla/5.0' });

async function postJson(path, body, auth, accept) {
  const dispatcher = new ProxyAgent(PROXY);
  const res = await fetch(BASE + path, { method: 'POST', headers: { ...headers(auth), accept: accept || 'application/json' },
    body: JSON.stringify(body), dispatcher });
  return res;
}

async function runNewConversation(auth) {
  const rNew = await postJson(CHAT_NEW_PATH, buildChatNewBody({}), auth);
  const j = await rNew.json();
  if (j.code !== 0 || !j.data?.id) throw new Error('chat/new 失败: code=' + j.code + ' msg=' + (j.msg || j.message || ''));
  const chatId = j.data.id;
  console.log(`[new-conversation] 会话 id=${chatId}`);
  await sendAndMerge(chatId, auth);
  return chatId;
}

async function sendAndMerge(chatId, auth) {
  const body = buildChatSendBody({ chatId, query: TEXT,
    model: arg('model', 'Auto'), thinkingMode: arg('thinking-mode', true) !== 'false', planningMode: false });
  const res = await postJson(CHAT_SEND_PATH, body, auth, 'text/event-stream');
  console.log(`[send] POST ${CHAT_SEND_PATH} -> ${res.status} ${res.headers.get('content-type')}`);
  if (!res.ok) { let t=''; try{ t=await res.text(); }catch{} throw new Error('send 失败: ' + res.status + ' body=' + t.slice(0,200)); }
  const parser = new SSEFrameParser(); const merger = new ChatStreamMerger();
  const reader = res.body.getReader();
  for (;;) { const { done, value } = await reader.read(); if (done) break;
    merger.applyAll(parser.push(value)); if (merger.finished) break; }
  merger.applyAll(parser.flush());
  console.log(`[result] cid=${merger.cid} finished=${merger.finished} answer=${JSON.stringify(merger.answer)}`);
  return merger;
}

// ---------------- main ----------------
try {
  if (FIXTURE) {
    let txt;
    if (FIXTURE.endsWith('.json')) { const j = JSON.parse(readFileSync(FIXTURE, 'utf8')); txt = j.sse ?? ''; }
    else txt = readFileSync(FIXTURE, 'utf8');
    const merger = new ChatStreamMerger().applyAll([...new SSEFrameParser().push(txt)]);
    console.log(JSON.stringify({ mode: 'fixture', finished: merger.finished, answer: merger.answer }, null, 2));
    process.exit(0);
  }
  // 构造（本地）
  if (SCEN === 'new-conversation') {
    buildChatNewBody({});
    if (TEXT) buildChatSendBody({ chatId: 1, query: TEXT }); // 仅校验字段（chat_id 占位不用于发送）
    console.log(`[dry-run] 将: POST ${CHAT_NEW_PATH} {scenario:1} → 取 id → POST ${CHAT_SEND_PATH} {scenario,thinking_mode,planning_mode,model,query,chat_id}`);
  } else if (SCEN === 'follow-up') {
    if (!CONV) throw new Error('follow-up 需要 --conversation-id');
    buildChatSendBody({ chatId: CONV, query: TEXT || '' });
    console.log(`[dry-run] 将: POST ${CHAT_SEND_PATH} 到会话 ${CONV}`);
  } else throw new Error('未知 --scenario: ' + SCEN);
  if (!LIVE) { console.log('[dry-run] 未发送任何网络请求。加 --live 才联网。'); process.exit(0); }
  if (!TEXT) throw new Error('--live 需要 --text');
  const auth = readAuth(STORAGE);
  if (SCEN === 'new-conversation') await runNewConversation(auth);
  else await sendAndMerge(CONV, auth);
} catch (e) {
  console.error('[error] ' + e.message);
  process.exit(1);
}
