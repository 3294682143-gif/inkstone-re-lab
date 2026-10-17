// 浏览器采集共享工具：patchright 为“可选”的浏览器依赖，按需加载并给出清晰安装指引。
// 参考 README「浏览器采集」：npm i -D patchright && npx patchright install chromium
export async function loadPatchright() {
  try {
    return await import('patchright');
  } catch {
    throw new Error(
      '未安装 patchright（浏览器采集需要，离线分析/测试不需要）。安装方法：\n' +
      '  npm i -D patchright && npx patchright install chromium\n' +
      '详见 README「浏览器采集（可选）」。'
    );
  }
}

/** 仅当显式配置代理时返回 launch 代理选项。 */
export function launchProxy(proxy) {
  return proxy ? { proxy: { server: proxy } } : {};
}

/** 解析代理：显式 > INKSTONE_PROXY > HTTPS_PROXY/HTTP_PROXY；否则 null（直连）。 */
export function resolveBrowserProxy(env = process.env, explicit = null) {
  const p = explicit || env.INKSTONE_PROXY || env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy || null;
  return p && String(p).trim() ? String(p).trim() : null;
}
