// regress.mjs — P6 回归：n 组独立新会话，每组两轮（新建+追问），全部走聊天会话层。
// 关键：任何一组失败 => 整体失败；n 必须为正整数；追问标记必须匹配；会话 ID 必须互不相同。
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, ArgError } from './args.mjs';
import { readAuth, resolveProxy, buildHeaders, createHttpClient, DEFAULT_BASE_URL } from './net.mjs';
import { createChatSession } from './chat-session.mjs';

export const HELP = `Intern InkStone 回归脚本

用法: node src/regress.mjs --n <组数> [选项]

  --help                      显示本帮助
  --n <int>                   组数，必须为大于 0 的整数（默认 3）
  --mark <str>                本轮标记前缀（每组生成 <mark>-0<i>）
  --out <path>                结果输出路径（默认 05-validation/regression.json）
  --storage-state <path>      本地登录态文件；亦可用 INKSTONE_STORAGE_STATE
  --base-url <url>            接口基址；亦可用 INKSTONE_BASE_URL
  --proxy <url>               显式代理；未配置则直连
  --timeout-ms <ms>           请求/读取超时（默认 60000；0 表示不超时）

退出码: 0 全部通过；1 任一组失败/未完成；2 参数错误。
每组判定: 首轮成功 + 追问成功 + 两轮均正常结束 + 追问包含本轮标记 + 会话 ID 一致。
任一组首轮失败时，不再发送该组追问。`;

const SPEC = {
  booleans: ['help'],
  values: ['n', 'mark', 'out', 'storage-state', 'base-url', 'proxy', 'timeout-ms'],
};

export async function run(argv, deps = {}) {
  const env = deps.env ?? process.env;
  const out = deps.stdout ?? ((s) => process.stdout.write(s + '\n'));
  const err = deps.stderr ?? ((s) => process.stderr.write(s + '\n'));

  let parsed;
  try { parsed = parseArgs(argv, SPEC); }
  catch (e) { if (e instanceof ArgError) { err('[error] ' + e.message); return 2; } throw e; }
  const { flags, vals } = parsed;
  if (flags.help) { out(HELP); return 0; }

  // n 校验：必须在读取凭据和联网之前
  const n = Number(vals.n ?? 3);
  if (!Number.isInteger(n) || n <= 0) { err('[error] --n 必须是大于 0 的整数'); return 2; }

  const timeoutMs = Number(vals['timeout-ms'] ?? env.INKSTONE_TIMEOUT_MS ?? 60000);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) { err('[error] --timeout-ms 必须是非负数字'); return 2; }

  const baseUrl = vals['base-url'] ?? env.INKSTONE_BASE_URL ?? DEFAULT_BASE_URL;
  const storage = vals['storage-state'] ?? env.INKSTONE_STORAGE_STATE ?? '01-evidence/private/inkstone-auth.json';
  const mark = vals.mark ?? 'INKSTONE-RE-REG';
  const outPath = vals.out ?? '05-validation/regression.json';

  let auth;
  try { auth = (deps.readAuth ?? readAuth)(storage); }
  catch (e) { err('[error] ' + e.message); return 1; }

  const http = createHttpClient({ baseUrl, proxy: resolveProxy(env, vals.proxy ?? null), fetchImpl: deps.fetchImpl, timeoutMs });
  const session = createChatSession({ http, headers: buildHeaders(auth, baseUrl), timeoutMs });

  const results = [];
  const ids = [];
  let executed = 0, completedTurns = 0;

  for (let i = 1; i <= n; i++) {
    const markI = `${mark}-0${i}`;
    const rec = { session: i, mark: markI, chatId: null, ok: false, turn1: null, turn2: null, reason: null };
    executed++;
    try {
      const chatId = await session.newConversation();
      rec.chatId = chatId; ids.push(String(chatId));

      const t1 = await session.send(chatId, `${markI}：请只回复 OK。`, { model: 'Auto' });
      completedTurns++;
      rec.turn1 = { status: t1.status, finished: t1.finished, cid: t1.cid, answerLen: (t1.answer || '').length };
      if (!t1.finished) { rec.reason = '首轮未正常结束'; }
      else if (String(t1.cid ?? '') !== String(chatId)) { rec.reason = '首轮 cid 与请求会话不一致'; }
      else {
        const t2 = await session.send(chatId, '请复述我上一条消息中的测试标记。', { model: 'Auto' });
        completedTurns++;
        rec.turn2 = {
          status: t2.status, finished: t2.finished, cid: t2.cid,
          answerLen: (t2.answer || '').length, hasMarker: !!(t2.answer && t2.answer.includes(markI)),
        };
        if (!t2.finished) rec.reason = '追问未正常结束';
        else if (String(t2.cid ?? '') !== String(chatId)) rec.reason = '追问 cid 与请求会话不一致';
        else if (!rec.turn2.hasMarker) rec.reason = '追问未包含本轮标记';
        else rec.ok = true;
      }
    } catch (e) {
      rec.reason = rec.reason || (e && e.name === 'ChatError' ? `${e.kind}: ${e.message}` : String(e && e.message));
    }
    results.push(rec);
    if (i < n) await (deps.sleep ?? ((ms) => new Promise(r => setTimeout(r, ms))))(1500);
  }

  const distinctSessionIds = new Set(ids).size === ids.length && ids.length === executed;
  const allOk = executed === n && results.every(r => r.ok) && distinctSessionIds;

  const summary = {
    n, executed, completedTurns, distinctSessionIds, allOk,
    sessions: results.map(r => ({
      session: r.session, chatId: r.chatId, ok: r.ok, reason: r.reason,
      turn1: r.turn1, turn2: r.turn2,
    })),
  };
  const payload = { tool: 'regress', generatedAt: new Date().toISOString(), mark, summary, results };

  try {
    mkdirSync(dirname(outPath), { recursive: true });
    (deps.writeFile ?? writeFileSync)(outPath, JSON.stringify(payload, null, 2));
    out(`[regress] 结果写入 ${outPath}`);
  } catch (e) { err('[error] 写入结果失败: ' + e.message); }

  out(JSON.stringify(summary, null, 2));
  return allOk ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = await run(process.argv.slice(2));
}
