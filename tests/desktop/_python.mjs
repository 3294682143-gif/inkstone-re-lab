// tests/desktop/_python.mjs
// 跨平台 Python 可执行文件发现（供需要调用 Python 的测试复用）。
// 契约：
//  1) 优先 INKSTONE_PYTHON（实际可执行文件路径）。
//  2) 否则探测 python3 / python / Windows 的 py -3。
//  3) 用 executable + args 数组执行，shell:false；不把带参数字符串当可执行文件。
//  4) 校验版本 >= 3.10（ASAR 工具使用的语法/Path API）。
//  5) 探测设置超时，避免 Windows 商店别名或无响应命令挂住测试。
//  6) 缺失时抛出明确环境错误，测试不得静默跳过。
import { execFileSync } from 'node:child_process';

const MIN = [3, 10];
const PROBE = 'import sys;print("%d.%d" % (sys.version_info[0], sys.version_info[1]))';

function tryCandidate(exe, args, timeoutMs) {
  try {
    const out = execFileSync(exe, [...args, '-c', PROBE], { encoding: 'utf8', shell: false, timeout: timeoutMs, stdio: ['ignore', 'pipe', 'pipe'] });
    const m = /^(\d+)\.(\d+)/.exec(String(out).trim());
    if (!m) return null;
    const major = Number(m[1]); const minor = Number(m[2]);
    return { exe, args, version: `${major}.${minor}`, ok: major > MIN[0] || (major === MIN[0] && minor >= MIN[1]) };
  } catch { return null; }
}

export function resolvePython({ env = process.env, timeoutMs = 5000 } = {}) {
  const candidates = [];
  if (env.INKSTONE_PYTHON) candidates.push([env.INKSTONE_PYTHON, []]);
  candidates.push(['python3', []], ['python', []]);
  if (process.platform === 'win32') candidates.push(['py', ['-3']]);

  const seen = [];
  for (const [exe, args] of candidates) {
    if (exe === 'py' && process.platform !== 'win32') continue;
    const r = tryCandidate(exe, args, timeoutMs);
    if (!r) { seen.push(`${exe} ${args.join(' ')}`.trim() + ' (not found/unusable)'); continue; }
    if (!r.ok) { seen.push(`${exe} -> ${r.version} (<${MIN.join('.')})`); continue; }
    return { exe: r.exe, args: r.args, version: r.version };
  }
  throw new Error('no usable Python >= ' + MIN.join('.') + ' found (set INKSTONE_PYTHON). Tried: ' + seen.join('; '));
}

/** 用发现的 Python 运行一段脚本/参数；返回 {code,out,err}。 */
export function runPython(py, args, opts = {}) {
  try { return { code: 0, out: execFileSync(py.exe, [...py.args, ...args], { encoding: 'utf8', shell: false, timeout: opts.timeoutMs ?? 60000 }) }; }
  catch (e) { return { code: e.status ?? 1, out: String(e.stdout || ''), err: String(e.stderr || '') }; }
}
