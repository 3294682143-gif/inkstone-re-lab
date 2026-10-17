// 参数解析：区分布尔参数与带值参数；未知参数/缺值/位置参数一律报错。
// 支持 `--key value` 与 `--key=value`。
export class ArgError extends Error {
  constructor(message) { super(message); this.name = 'ArgError'; }
}

/**
 * @param {string[]} argv
 * @param {{booleans?: string[], values?: string[], aliases?: Record<string,string>}} spec
 * @returns {{flags: Record<string,boolean>, vals: Record<string,string>}}
 */
export function parseArgs(argv, spec = {}) {
  const booleans = new Set(spec.booleans ?? []);
  const values = new Set(spec.values ?? []);
  const aliases = spec.aliases ?? {};
  const flags = {};
  const vals = {};

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (typeof a !== 'string' || !a.startsWith('--') || a === '--') {
      throw new ArgError(`未知位置参数: ${a}`);
    }
    let key = a.slice(2);
    let val = null;
    let hasEq = false;
    const eq = key.indexOf('=');
    if (eq >= 0) { val = key.slice(eq + 1); key = key.slice(0, eq); hasEq = true; }
    key = aliases[key] ?? key;

    if (booleans.has(key)) {
      if (hasEq) throw new ArgError(`--${key} 是布尔参数，不接受取值`);
      flags[key] = true;
    } else if (values.has(key)) {
      if (!hasEq) {
        const n = argv[i + 1];
        if (n === undefined || (typeof n === 'string' && n.startsWith('--')))
          throw new ArgError(`--${key} 需要取值`);
        val = n; i++;
      }
      vals[key] = val;
    } else {
      throw new ArgError(`未知参数: --${key}`);
    }
  }
  return { flags, vals };
}
