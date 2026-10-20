// tests/fixtures/mock-headless-driver.mjs
// Linux 离线模拟正式 headless driver 的**子进程**（MOCK，不是 Windows/LIVE 验证）。
// 协议：stdin/stdout JSON Lines；请求仅 {id,method,params}；响应 {id,ok,result|error}；
//       通知 {method,params}（driver.ready / turn.completed / turn.failed）。
// 用法：node mock-headless-driver.mjs [--mode normal|terminal-first|no-terminal|error|hang|crash]
import { createInterface } from 'node:readline';

const args = process.argv.slice(2);
const mode = (() => { const i = args.indexOf('--mode'); return i >= 0 ? args[i + 1] : 'normal'; })();
const PROTOCOL = 'inkstone-headless-chat/v1';
const emit = (obj) => process.stdout.write(JSON.stringify(obj) + '\n');
const ok = (id, result) => emit({ id, ok: true, result });
const fail = (id, code, message) => emit({ id, ok: false, error: { code, message } });

let seq = 0;
const sessions = new Map();
let turnTimer = null;

const rl = createInterface({ input: process.stdin });
setImmediate(() => emit({ method: 'driver.ready', params: { protocol_version: PROTOCOL } }));

rl.on('line', (line) => {
  if (!line.trim()) return;
  let req;
  try { req = JSON.parse(line); } catch { emit({ id: 'unknown', ok: false, error: { code: 'HEADLESS_INVALID_JSON', message: 'bad json' } }); return; }
  const { id, method, params = {} } = req;
  if (mode === 'hang') return;                       // 完全不响应（测超时）
  if (mode === 'crash') { process.exit(3); }         // 异常退出

  switch (method) {
    case 'projects.list':
      return ok(id, { projects: [{ id: 'proj_syn', name: 'Synthetic Project', description: 'synthetic' }] });
    case 'models.list':
      return ok(id, { models: [{ ref: 'synth-model-a', display_name: 'Synthetic A' }], work_modes: ['general', 'research'], permission_modes: ['request', 'risk_based'] });
    case 'session.create': {
      const session_ref = 'sess_syn_' + (++seq);
      sessions.set(session_ref, { messages: [], lastRequestId: null, lastTurnId: null });
      return ok(id, {
        session_ref,
        project_id: params.project ?? 'proj_syn', project_name: 'Synthetic Project',
        model_ref: params.model ?? 'synth-model-a', work_mode: params.work_mode ?? 'general',
        permission_mode: params.permission_mode ?? 'request', cleanup: params.cleanup === true,
      });
    }
    case 'session.open': return ok(id, { session_ref: params.session_ref });
    case 'session.inspect': return ok(id, { session_ref: params.session_ref, active_turn: undefined });
    case 'session.close': return ok(id, { session_ref: params.session_ref, closed: true });
    case 'turn.send': {
      const session = sessions.get(params.session_ref) || { messages: [] };
      const request_id = 'req_syn_' + (++seq);
      const turn_id = 'turn_syn_' + seq;
      session.lastRequestId = request_id; session.lastTurnId = turn_id;
      const marker = extractMarker(params.query);
      const complete = () => {
        if (mode === 'no-terminal') return;
        session.messages.push({ role: 'assistant', requestId: request_id, turnId: turn_id, status: 'complete', content: marker ? `OK ${marker}` : 'OK' });
        emit({ method: 'turn.completed', params: { session_ref: params.session_ref, request_id, turn_id, status: 'complete', answer: marker ? `OK ${marker}` : 'OK', model_ref: 'synth-model-a' } });
      };
      if (mode === 'terminal-first') { complete(); return ok(id, { accepted: true, session_ref: params.session_ref, request_id }); }
      if (mode === 'error') return fail(id, 'HEADLESS_TURN_FAILED', 'synthetic failure');
      turnTimer = setTimeout(complete, 80);
      return ok(id, { accepted: true, session_ref: params.session_ref, request_id });
    }
    case 'turn.stop': {
      if (turnTimer) { clearTimeout(turnTimer); turnTimer = null; }
      const session = sessions.get(params.session_ref);
      if (session) session.messages.push({ role: 'assistant', requestId: params.request_id, turnId: session.lastTurnId, status: 'stopped', content: 'partial' });
      emit({ method: 'turn.completed', params: { session_ref: params.session_ref, request_id: params.request_id, turn_id: session?.lastTurnId, status: 'stopped', answer: 'partial' } });
      return ok(id, { stopped: true, session_ref: params.session_ref, request_id: params.request_id });
    }
    case 'history.get': {
      const session = sessions.get(params.session_ref) || { messages: [] };
      return ok(id, { session_ref: params.session_ref, active_request_id: undefined, messages: session.messages });
    }
    case 'approval.list': return ok(id, { approvals: [] });
    case 'approval.respond': return ok(id, { accepted: true });
    case 'system.shutdown':
      ok(id, { bye: true });
      setTimeout(() => process.exit(0), 20);
      return;
    default:
      return fail(id, 'HEADLESS_UNKNOWN_METHOD', 'unknown method ' + method);
  }
});

function extractMarker(query) {
  if (typeof query !== 'string') return '';
  const m = /(INKSTONE-[A-Z0-9-]+|MARK-[A-Z0-9-]+)/.exec(query);
  return m ? m[1] : '';
}
