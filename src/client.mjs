#!/usr/bin/env node
// client.mjs — Intern InkStone 聊天最小客户端（CLI 核心，可被测试以依赖注入方式调用）。
// 默认/--dry-run 不发网络请求；--live 才联网。凭证只从本地 storageState 读取，不写入源码/日志。
// 代理仅在明确配置时启用（--proxy 或 INKSTONE_PROXY/HTTPS_PROXY/HTTP_PROXY），否则直连。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs, ArgError } from './args.mjs';
import { SSEFrameParser, ChatStreamMerger } from './stream-parser.mjs';
import { buildChatSendBody, buildChatNewBody, CHAT_SEND_PATH, CHAT_NEW_PATH } from './build-chat-request.mjs';
import { readAuth, resolveProxy, buildHeaders, createHttpClient, DEFAULT_BASE_URL } from './net.mjs';
import { createChatSession, ChatError } from './chat-session.mjs';

export const HELP = `Intern InkStone 最小客户端

用法: node src/client.mjs [选项]

  --help                      显示本帮助（不读取登录态、不联网）
  --dry-run                   仅本地构造与校验，绝不发送网络请求（默认行为）
  --live                      显式启用真实网络调用（与 --dry-run 互斥）
  --scenario <name>           new-conversation（默认） | follow-up
  --text <text>               本轮用户文本（--live 必填）
  --conversation-id <id>      follow-up 时指定上一轮真实返回的会话 id
  --fixture <path>            读取本地脱敏样本（.sse.txt 或含 sse 字段的 .json）作为一次响应
  --model <key>               模型 key（默认 Auto）
  --storage-state <path>      本地登录态文件；亦可用环境变量 INKSTONE_STORAGE_STATE
  --base-url <url>            接口基址；亦可用 INKSTONE_BASE_URL（默认 ${DEFAULT_BASE_URL}）
  --proxy <url>               显式代理；亦可用 INKSTONE_PROXY/HTTPS_PROXY/HTTP_PROXY（未配置则直连）
  --timeout-ms <ms>           请求/读取超时（默认 60000；0 表示不超时）

退出码: 0 成功；1 运行失败（HTTP/业务/未正常结束）；2 参数错误（含 --dry-run 与 --live 冲突）。

鉴权: 仅从 storageState 读取 Cookie 与 uaa-token；--help/--dry-run 不读取、不联网。
结束语义: SSE 的 workflow_finished（不使用 [DONE]）。
环境变量: 本程序不会自动加载 .env 文件；请用 shell 导出（export INKSTONE_BASE_URL=...）或在命令行传参。`;

const SPEC = {
  booleans: ['help', 'dry-run', 'live'],
  values: ['scenario', 'text', 'conversation-id', 'fixture', 'model', 'storage-state', 'base-url', 'proxy', 'timeout-ms'],
};

function readFixture(path) {
  const raw = readFileSync(path, 'utf8');
  if (path.endsWith('.json')) { const j = JSON.parse(raw); return j.sse ?? ''; }
  return raw;
}

/**
 * CLI 逻辑核心。deps 允许注入：env / stdout / stderr / fetchImpl / readAuth。
 * @returns {Promise<number>} 退出码
 */
export async function run(argv, deps = {}) {
  const env = deps.env ?? process.env;
  const out = deps.stdout ?? ((s) => process.stdout.write(s + '\n'));
  const err = deps.stderr ?? ((s) => process.stderr.write(s + '\n'));

  // 1) 参数解析（未知参数/缺值在这里就失败）
  let parsed;
  try { parsed = parseArgs(argv, SPEC); }
  catch (e) {
    if (e instanceof ArgError) { err('[error] ' + e.message); return 2; }
    throw e;
  }
  const { flags, vals } = parsed;

  // 2) help 最优先：不读凭据、不联网
  if (flags.help) { out(HELP); return 0; }

  // 3) 冲突：--dry-run 与 --live（在读凭据/联网之前）
  if (flags['dry-run'] && flags.live) { err('[error] --dry-run 与 --live 不能同时使用'); return 2; }

  // 4) 场景校验（读凭据/联网之前）
  const scenario = vals.scenario ?? 'new-conversation';
  if (scenario !== 'new-conversation' && scenario !== 'follow-up') {
    err('[error] 未知 --scenario: ' + scenario); return 2;
  }
  if (scenario === 'follow-up' && !vals['conversation-id']) {
    err('[error] follow-up 需要 --conversation-id'); return 2;
  }
  const timeoutMs = Number(vals['timeout-ms'] ?? env.INKSTONE_TIMEOUT_MS ?? 60000);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) { err('[error] --timeout-ms 必须是非负数字'); return 2; }

  const baseUrl = vals['base-url'] ?? env.INKSTONE_BASE_URL ?? DEFAULT_BASE_URL;
  const storage = vals['storage-state'] ?? env.INKSTONE_STORAGE_STATE ?? '01-evidence/private/inkstone-auth.json';
  const model = vals.model ?? 'Auto';

  // 5) fixture 离线模式：不读凭据、不联网
  if (vals.fixture) {
    try {
      const text = readFixture(vals.fixture);
      const parser = new SSEFrameParser();               // 同一实例执行 push 与 flush（尾帧不丢）
      const merger = new ChatStreamMerger().applyAll([...parser.push(text), ...parser.flush()]);
      const finished = merger.finished;
      out(JSON.stringify({ mode: 'fixture', finished, answer: merger.answer }, null, 2));
      return finished ? 0 : 1;               // 不完整样本也判失败
    } catch (e) { err('[error] 读取样本失败: ' + e.message); return 1; }
  }

  // 6) 默认/--dry-run：只做本地构造，零网络
  const dry = flags['dry-run'] || !flags.live;
  if (dry) {
    try {
      if (scenario === 'new-conversation') {
        buildChatNewBody({});
        if (vals.text) buildChatSendBody({ chatId: 1, query: vals.text, model });
        out(`[dry-run] 将: POST ${CHAT_NEW_PATH} {scenario:1} → 取 id → POST ${CHAT_SEND_PATH} {scenario,thinking_mode,planning_mode,model,query,chat_id}`);
      } else {
        buildChatSendBody({ chatId: vals['conversation-id'], query: vals.text || '', model });
        out(`[dry-run] 将: POST ${CHAT_SEND_PATH} 到会话 ${vals['conversation-id']}`);
      }
    } catch (e) { err('[error] ' + e.message); return 2; }
    out('[dry-run] 未发送任何网络请求。加 --live 才联网。');
    return 0;
  }

  // 7) live
  if (!vals.text) { err('[error] --live 需要 --text'); return 2; }

  let auth;
  try { auth = (deps.readAuth ?? readAuth)(storage); }
  catch (e) { err('[error] ' + e.message); return 1; }

  const http = createHttpClient({ baseUrl, proxy: resolveProxy(env, vals.proxy ?? null), fetchImpl: deps.fetchImpl, timeoutMs });
  const session = createChatSession({ http, headers: buildHeaders(auth, baseUrl), timeoutMs });

  try {
    if (scenario === 'new-conversation') {
      const id = await session.newConversation();
      out(`[new-conversation] 会话 id=${id}`);
      const r = await session.send(id, vals.text, { model, thinkingMode: true });
      out(`[result] cid=${r.cid} finished=${r.finished} answer=${JSON.stringify(r.answer)}`);
    } else {
      const r = await session.send(vals['conversation-id'], vals.text, { model, thinkingMode: true });
      out(`[result] cid=${r.cid} finished=${r.finished} answer=${JSON.stringify(r.answer)}`);
    }
    return 0;
  } catch (e) {
    const extra = (e instanceof ChatError && e.partial) ? ` (partial answer 长度=${e.partial.length}，未完成)` : '';
    err('[error] ' + e.message + extra);
    return 1;
  }
}

// 直接运行时执行
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = await run(process.argv.slice(2));
}
