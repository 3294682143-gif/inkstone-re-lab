// 服务进程测试辅助：起一个本地 node 服务并等它就绪（mock 网关 / 自研前端共用）。
// 复用点：tests/mock-gateway.test.mjs、tests/aiyan-ui.test.mjs、scripts/ui-verify.mjs。
import { spawn } from 'node:child_process';
import net from 'node:net';
import { once } from 'node:events';

export async function freePort() {
  const srv = net.createServer();
  srv.listen(0, '127.0.0.1');
  await once(srv, 'listening');
  const port = srv.address().port;
  srv.close();
  await once(srv, 'close');
  return port;
}

/**
 * 启动一个本地服务脚本并等待就绪。
 * @param {string} script 相对仓库根的脚本路径
 * @param {object} [opts]
 * @param {string[]} [opts.args] 追加参数（端口会自动追加 --port）
 * @param {string} [opts.healthPath] 就绪探测路径，默认 /health
 * @param {number} [opts.timeoutMs] 就绪超时，默认 10000
 * @param {object} [opts.env] 额外环境变量
 * @returns {Promise<{child: import('node:child_process').ChildProcess, base: string, port: number}>}
 */
export async function startServer(script, opts = {}) {
  const port = await freePort();
  const args = [script, '--port', String(port), '--host', '127.0.0.1', ...(opts.args || [])];
  const child = spawn(process.execPath, args, {
    stdio: 'ignore',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '', ...(opts.env || {}) },
  });
  const base = 'http://127.0.0.1:' + port;
  const health = opts.healthPath || '/health';
  const deadline = Date.now() + (opts.timeoutMs || 10000);
  while (Date.now() < deadline) {
    try {
      const r = await fetch(base + health);
      if (r.ok) return { child, base, port };
    } catch {
      // 服务还没起来
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  child.kill();
  throw new Error(script + ' 未在超时内就绪');
}
