#!/usr/bin/env node
// scripts/windows-driver-smoke.mjs
// InkStone 桌面应用 headless driver 的接续冒烟工具（Windows 用正式 exe；Linux 可用 --mock 验证 runner）。
// 场景：preflight / discovery / chat / cancel。输出 JSON 到 --out 目录。
// MOCK 模式只用于 Linux 离线验证 runner 与协议协调逻辑，不代表 Windows/LIVE 验证。
import { existsSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDriverProcess, DriverProcessError } from '../src/desktop/driver-process.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const MOCK_DRIVER = resolve(HERE, '../tests/fixtures/mock-headless-driver.mjs');

function arg(name, def) { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? (process.argv[i + 1] ?? true) : def; }
const HELP = !!arg('help', false);
const MOCK = !!arg('mock', false);
const EXE = arg('exe', null);
const OUT = arg('out', null);
const SCENARIO = arg('scenario', null);
const PROJECT = arg('project', null);
const MODEL = arg('model', null);
const TIMEOUT = Number(arg('timeout-ms', 120000));
const MOCK_MODE = arg('mock-mode', 'normal');

const USAGE = `InkStone headless driver 冒烟工具（runner）

用法:
  node scripts/windows-driver-smoke.mjs --help
  node scripts/windows-driver-smoke.mjs --preflight --exe <桌面应用.exe> --out <目录>
  node scripts/windows-driver-smoke.mjs --exe <exe> --scenario discovery --out <目录>
  node scripts/windows-driver-smoke.mjs --exe <exe> --scenario chat   --project <项目> --model <模型> --out <目录>
  node scripts/windows-driver-smoke.mjs --exe <exe> --scenario cancel --project <项目> --model <模型> --out <目录>

选项:
  --mock                Linux 离线：spawn tests/fixtures/mock-headless-driver.mjs（MOCK，不联网）
  --mock-mode <mode>    normal|terminal-first|no-terminal|error|hang|crash（配合 --mock）
  --timeout-ms <ms>     回合/请求超时（默认 120000）
说明: 正式模式启动的是桌面应用主 exe（环境变量 INKSTONE_HEADLESS_CHAT_DRIVER=1），不是 agentd/brokerd/executor。`;

function nowRun() { return new Date().toISOString().replace(/[:.]/g, '-'); }
function ensureOut(dir) { if (!existsSync(dir)) mkdirSync(dir, { recursive: true }); return dir; }
function writeJson(dir, name, obj) { const p = join(dir, name); writeFileSync(p, JSON.stringify(obj, null, 2)); return p; }

function makeTarget() {
  if (MOCK) return { exe: process.execPath, args: [MOCK_DRIVER, '--mode', MOCK_MODE], mock: true };
  if (!EXE) throw new DriverProcessError('--exe required (or use --mock)', { code: 'ARGS' });
  if (!existsSync(EXE)) throw new DriverProcessError('exe not found: ' + EXE, { code: 'ARGS' });
  // 实测：inkstone.exe 把 --headless-chat-driver 当 unknown switch 拒绝（bad option, exit 9）。
  // 契约 06-desktop/contracts/driver-jsonl.md 记录了两条入口，改用文档化的环境变量入口。
  return { exe: EXE, args: [], env: { ...appEnv(), INKSTONE_HEADLESS_CHAT_DRIVER: '1' }, mock: false };
}

// Electron 应用必须清掉 ELECTRON_RUN_AS_NODE，否则 inkstone.exe 会以纯 Node 模式启动（不加载 app）。
function appEnv() {
  const e = { ...process.env };
  delete e.ELECTRON_RUN_AS_NODE;
  delete e.ELECTRON_NO_ATTACH_CONSOLE;
  return e;
}

function marker() { return 'INKSTONE-W-' + Date.now().toString(36).toUpperCase(); }

async function preflight() {
  const exe = MOCK ? '(mock)' : EXE;
  const exeOk = MOCK ? true : (EXE && existsSync(EXE));
  const manifestPath = resolve(HERE, '../01-evidence/private/desktop-027/payload/resources/runtime/manifest.json');
  const manifest = existsSync(manifestPath) ? JSON.parse((await import('node:fs')).readFileSync(manifestPath, 'utf8')) : null;
  return {
    mode: MOCK ? 'MOCK' : 'WINDOWS_TARGET',
    node: process.version, platform: process.platform, pythonless: true,
    exe, exe_exists: exeOk,
    out: OUT,
    sample_manifest: manifest ? { bundle_build_id: manifest.bundle_build_id, platform: manifest.platform, arch: manifest.arch } : 'absent (expected on Linux)',
    inference_requested: false,
  };
}

async function runDriver(scenario, opts) {
  const target = makeTarget();
  const driver = createDriverProcess({ exe: target.exe, args: target.args, env: target.env ?? process.env, timeouts: { turn: TIMEOUT, request: TIMEOUT }, log: () => {} });
  const result = { scenario, mode: target.mock ? 'MOCK' : 'WINDOWS_TARGET', ok: false, steps: [] };
  try {
    driver.start();
    const ready = await driver.waitReady();
    result.steps.push({ step: 'ready', protocol_version: ready, ok: ready === 'inkstone-headless-chat/v1' });

    if (scenario === 'discovery') {
      const projects = await driver.request('projects.list', {});
      const models = await driver.request('models.list', {});
      result.steps.push({ step: 'projects.list', ok: projects.ok });
      result.steps.push({ step: 'models.list', ok: models.ok });
      result.projects = projects.ok ? (projects.result.projects || []) : [];
      result.models = models.ok ? (models.result.models || []) : [];
      result.work_modes = models.ok ? models.result.work_modes : undefined;
      result.permission_modes = models.ok ? models.result.permission_modes : undefined;
      result.ok = projects.ok && models.ok;
    } else if (scenario === 'chat') {
      const project = opts.project ?? 'proj_syn';
      const model = opts.model ?? 'synth-model-a';
      const created = await driver.request('session.create', { project, model, cleanup: false, work_mode: opts.work_mode ?? 'general', permission_mode: opts.permission_mode ?? 'request' });
      if (!created.ok) throw new DriverProcessError('session.create failed: ' + created.error?.code, { code: 'REMOTE' });
      const sessionRef = created.result.session_ref;
      result.session_ref = sessionRef;
      result.steps.push({ step: 'session.create', ok: true, cleanup: created.result.cleanup });

      const mark = marker();
      const t1 = await driver.sendTurn({ sessionRef, query: `${mark}：请只回复 OK。`, timeoutMs: TIMEOUT });
      result.steps.push({ step: 'turn1', outcome: t1.outcome, request_id: t1.requestId });
      result.turn1 = { requestId: t1.requestId, outcome: t1.outcome, answer: t1.notification?.params?.answer };

      const t2 = await driver.sendTurn({ sessionRef, query: '请复述我上一条消息中的测试标记。', timeoutMs: TIMEOUT });
      result.steps.push({ step: 'turn2', outcome: t2.outcome, request_id: t2.requestId });
      result.turn2 = { requestId: t2.requestId, outcome: t2.outcome, answer: t2.notification?.params?.answer };

      const hist = await driver.request('history.get', { session_ref: sessionRef });
      result.history = hist.ok ? hist.result : null;
      result.unique_marker = mark;
      result.ok = t1.outcome === 'completed' && t2.outcome === 'completed';
    } else if (scenario === 'cancel') {
      const project = opts.project ?? 'proj_syn';
      const model = opts.model ?? 'synth-model-a';
      const created = await driver.request('session.create', { project, model, cleanup: false });
      const sessionRef = created.result.session_ref;
      result.session_ref = sessionRef;
      const mark = marker();
      const resp = await driver.request('turn.send', { session_ref: sessionRef, query: `${mark}：请只回复 OK。` });
      const requestId = resp.result?.request_id;
      result.steps.push({ step: 'turn.send', accepted: resp.result?.accepted === true, request_id: requestId });
      // 立即停止（在终态之前）；mock 的 turn.stop 会以 stopped 终态收尾
      const stop = await driver.request('turn.stop', { session_ref: sessionRef, request_id: requestId });
      result.stop = stop.ok ? stop.result : { error: stop.error };
      let outcome;
      try { outcome = (await driver.waitTerminal(requestId, { timeoutMs: TIMEOUT })).outcome; }
      catch (e) { outcome = 'no-terminal'; result.stop_wait_error = e.code; }
      const hist = await driver.request('history.get', { session_ref: sessionRef });
      result.terminal_outcome = outcome;
      result.history = hist.ok ? hist.result : null;
      // 竞争判定：若终态为 completed 出现在停止之前，按“竞争情况下已完成”，不算取消成功
      result.race_completed_before_stop = outcome === 'completed';
      result.ok = stop.ok && (outcome === 'stopped' || outcome === 'failed');
      result.note = 'local stop ≠ 服务端停止/计费（UNKNOWN）';
    }
    return result;
  } catch (e) {
    result.error = { code: e.code || e.name, message: String(e.message).slice(0, 200) };
    return result;
  } finally {
    try { await driver.shutdown(); } catch { /* ignore */ }
    result.exit = driver.exitInfo;
    result.protocol_errors = driver.protocolErrors;
    if (!target.mock) result.stderr_head = driver.stderrText.slice(0, 400);
  }
}

async function main() {
  if (HELP || (!SCENARIO && !arg('preflight', false))) { console.log(USAGE); return 0; }
  ensureOut(OUT || '.');
  const out = ensureOut(OUT || '.');
  let payload;
  if (arg('preflight', false)) payload = await preflight();
  else if (SCENARIO === 'discovery' || SCENARIO === 'chat' || SCENARIO === 'cancel') payload = await runDriver(SCENARIO, { project: PROJECT, model: MODEL });
  else { console.error('unknown --scenario: ' + SCENARIO); return 2; }
  payload.generated_at = new Date().toISOString();
  const file = writeJson(out, `${SCENARIO || 'preflight'}-${nowRun()}.json`, payload);
  console.log(JSON.stringify({ scenario: SCENARIO || 'preflight', ok: payload.ok ?? (SCENARIO ? false : undefined), file, mode: payload.mode }, null, 2));
  return (SCENARIO && payload.ok === false) ? 1 : 0;
}

main().then((c) => { process.exitCode = c; }).catch((e) => { console.error('[error] ' + (e.code || e.name) + ': ' + e.message); process.exitCode = 1; });
