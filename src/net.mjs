// 网络层：使用项目自身依赖（undici）解析，不再依赖任何外部/服务器绝对路径。
// 代理仅在“明确配置”时启用；未配置时直连（不设 dispatcher）。
import { readFileSync, existsSync } from 'node:fs';
import { ProxyAgent } from 'undici';

export const DEFAULT_BASE_URL = 'https://discovery.intern-ai.org.cn';

/** 解析代理：显式参数 > INKSTONE_PROXY > HTTPS_PROXY/HTTP_PROXY；都没有则 null（直连）。 */
export function resolveProxy(env = {}, explicit = null) {
  const p = explicit
    || env.INKSTONE_PROXY
    || env.HTTPS_PROXY || env.https_proxy
    || env.HTTP_PROXY || env.http_proxy
    || null;
  return p && String(p).trim() ? String(p).trim() : null;
}

export function makeDispatcher(proxy) {
  return proxy ? new ProxyAgent(proxy) : undefined;
}

/** 从本地 storageState 读取鉴权（Cookie + uaa-token）。只读路径，绝不打印内容。 */
export function readAuth(path, fs = { readFileSync, existsSync }) {
  if (!fs.existsSync(path)) throw new Error(`storage-state 不存在: ${path}`);
  const d = JSON.parse(fs.readFileSync(path, 'utf8'));
  const host = 'discovery.intern-ai.org.cn';
  const jar = (d.cookies || []).filter(c => host.endsWith(String(c.domain).replace(/^\./, '')) || String(c.domain).includes('openxlab'));
  const cookie = jar.map(c => `${c.name}=${c.value}`).join('; ');
  const tk = (d.cookies || []).find(c => c.name === 'uaa-token')?.value;
  if (!tk) throw new Error('storage-state 缺少 uaa-token（无法构造 Authorization）');
  return { cookie, token: tk };
}

export function buildHeaders(auth, baseUrl = DEFAULT_BASE_URL) {
  return {
    'content-type': 'application/json',
    'origin': baseUrl,
    'referer': baseUrl + '/chat/',
    'cookie': auth.cookie,
    'authorization': 'Bearer ' + auth.token,
    'user-agent': 'Mozilla/5.0',
  };
}

/**
 * 构造 HTTP 客户端。fetchImpl 可注入用于离线测试（默认全局 fetch）。
 * 代理只有在 proxy 非空时才使用。signal 由调用方提供时以调用方为准（用于整体超时）。
 */
export function createHttpClient({ baseUrl = DEFAULT_BASE_URL, proxy = null, fetchImpl = fetch, timeoutMs = 60000 } = {}) {
  const dispatcher = makeDispatcher(proxy);
  return {
    baseUrl,
    proxy,
    dispatcher,
    async post(path, { headers = {}, body, accept, signal, timeoutMs: t } = {}) {
      const ms = t ?? timeoutMs;
      let ac = signal ? null : new AbortController();
      let timer = null;
      let sig = signal;
      if (!sig) {
        sig = ac.signal;
        if (ms > 0) timer = setTimeout(() => ac.abort(new Error('请求超时')), ms);
      }
      try {
        const opts = {
          method: 'POST',
          headers: { ...headers, accept: accept || 'application/json' },
          body: JSON.stringify(body),
          signal: sig,
        };
        if (dispatcher) opts.dispatcher = dispatcher;
        return await fetchImpl(baseUrl + path, opts);
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
  };
}
