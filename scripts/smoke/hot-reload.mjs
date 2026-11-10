// 실제 Node 런타임에서 핫리로드 확인 (기본 importModule 사용)
// 실행: pnpm -r build && node scripts/smoke/hot-reload.mjs
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventLog, HookBus, HotReloader, PluginLoader } from '../../packages/kernel/dist/index.js';

const tmp = mkdtempSync(join(tmpdir(), 'hx-smoke-'));
const root = join(tmp, 'plugins');
const dir = join(root, 'hello');
cpSync(fileURLToPath(new URL('../../examples/plugins/hello', import.meta.url)), dir, { recursive: true });
const log = new EventLog({ root: join(tmp, 'logs') });
const lines = [];
const loader = new PluginLoader({
  hooks: new HookBus({ log }),
  log,
  roots: [{ dir: root, origin: 'user' }],
  lockFile: join(tmp, 'plugins.lock'),
  logger: (l) => lines.push(l),
});
await loader.loadAll();
const hr = new HotReloader(loader, { roots: [{ dir: root, origin: 'user' }] });
await hr.start();
const t0 = Date.now();
const done = new Promise((res, rej) => {
  hr.once('reloaded', res);
  hr.once('failed', (f) => rej(new Error(f.error)));
  setTimeout(() => rej(new Error('timeout')), 3000);
});
const f = join(dir, 'index.js');
writeFileSync(f, readFileSync(f, 'utf8').replace("'hello-v1'", "'hello-v2'"));
let code = 0;
try {
  await done;
  const v = loader.plugins.get('hello').module.VERSION;
  console.log(`reloaded in ${Date.now() - t0}ms, VERSION=${v}`);
  if (v !== 'hello-v2') code = 1;
} catch (e) {
  console.error('FAIL', e.message);
  code = 1;
}
await hr.stop();
log.close();
rmSync(tmp, { recursive: true, force: true });
process.exit(code);
