import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// 导入即证明这些模块在纯 Node 下可加载（不依赖 Electron）。
import * as gateway from '../../src/desktop/gateway-events.mjs';
import * as driver from '../../src/desktop/driver-jsonl.mjs';
import * as models from '../../src/desktop/models-contract.mjs';
import * as cloud from '../../src/desktop/cloud-adapter.mjs';

const DIR = fileURLToPath(new URL('../../src/desktop/', import.meta.url));

test('桌面协议模块在纯 Node 下可导入', () => {
  assert.ok(gateway.parseGatewayEvent && gateway.GatewayEventSequence);
  assert.ok(driver.HEADLESS_CHAT_PROTOCOL_VERSION);
  assert.ok(models.parseCapabilities);
  assert.ok(cloud.createCloudAdapter);
});

test('src/desktop 不 import electron，也不 import 解包后的主 bundle', () => {
  for (const f of readdirSync(DIR).filter((n) => n.endsWith('.mjs'))) {
    const s = readFileSync(DIR + f, 'utf8');
    // 只检查真正的 import/require 语句（注释中的证据文件名属溯源信息，不算依赖）
    const specs = [...s.matchAll(/^\s*import\s[^\n]*?from\s*['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)/gm)]
      .map((m) => m[1] ?? m[2]);
    for (const spec of specs) {
      assert.ok(spec !== 'electron', `${f} 不得 import electron`);
      assert.ok(!/01-evidence|index-CYl10ENn/.test(spec), `${f} 不得 import 解包产物`);
    }
  }
});
