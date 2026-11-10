#!/usr/bin/env node
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import type { EngineAdapter } from '@harness-x/protocol';
import type { EngineScanSnapshot } from './api/engines-routes.js';
import { DEFAULT_API_PORT, startApiServer } from './api/server.js';
import { getLoginStatus } from './auth-status.js';
import { EventLog } from './event-log.js';
import { HookBus } from './hooks.js';
import { HotReloader } from './hot-reload.js';
import { PluginLoader, defaultPluginRoots, harnessHome } from './loader.js';
import { SecretStore } from './secrets.js';

const HELP = `harness-x — 엔진 중립 에이전트 하네스

사용법:
  harness-x serve [옵션]     로컬 API 서버 실행 (기본 127.0.0.1:${DEFAULT_API_PORT})

옵션:
  --port <n>          포트 (기본 ${DEFAULT_API_PORT}, 0 = 임의)
  --host <h>          바인딩 주소 (루프백만 허용)
  --workspace <dir>   워크스페이스 폴더 (<dir>/.harness-x/plugins 탐색)
  --plugins <dir>     추가 플러그인 루트 (여러 번 가능)
  --no-watch          핫리로드 끄기
  -h, --help          도움말
`;

/** dist/cli.js → 저장소 루트 (packages/kernel/dist → ../../..) */
function repoRoot(): string | undefined {
  const guess = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');
  return existsSync(join(guess, 'pnpm-workspace.yaml')) ? guess : undefined;
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      port: { type: 'string' },
      host: { type: 'string' },
      workspace: { type: 'string' },
      plugins: { type: 'string', multiple: true },
      'no-watch': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const cmd = positionals[0];
  if (values.help || !cmd) {
    process.stdout.write(HELP);
    return cmd || values.help ? 0 : 1;
  }
  if (cmd !== 'serve') {
    process.stderr.write(`알 수 없는 명령: ${cmd}\n\n${HELP}`);
    return 1;
  }

  const home = harnessHome();
  const log = new EventLog({ root: join(home, 'logs') });
  const hooks = new HookBus({ log });
  const roots = [
    ...defaultPluginRoots({ workspace: values.workspace, repoRoot: repoRoot(), home }),
    ...(values.plugins ?? []).map((dir) => ({ dir: resolve(dir), origin: 'extra' as const })),
  ];
  const loader = new PluginLoader({
    hooks,
    log,
    roots,
    logger: (l) => process.stderr.write(l + '\n'),
  });
  const active = await loader.loadAll();

  const port = values.port !== undefined ? Number(values.port) : DEFAULT_API_PORT;
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    process.stderr.write(`잘못된 포트: ${values.port}\n`);
    return 1;
  }
  const workspace = resolve(values.workspace ?? process.cwd());
  /** 로드된 엔진 플러그인이 내보낸 어댑터 (`export const engines: EngineAdapter[]`) */
  const adapters = () =>
    [...loader.plugins.values()].flatMap((p) => {
      const list = (p.module as { engines?: unknown } | undefined)?.engines;
      return p.state === 'active' && Array.isArray(list) ? (list as EngineAdapter[]) : [];
    });
  const enginesCache = join(home, 'engines.json');
  let server;
  try {
    server = await startApiServer({
      loader,
      log,
      host: values.host,
      port,
      terminal: { cwd: () => workspace },
      engines: {
        secrets: new SecretStore(),
        scan: () =>
          existsSync(enginesCache)
            ? (JSON.parse(readFileSync(enginesCache, 'utf8')) as EngineScanSnapshot)
            : null,
        rescan: async () => {
          // engine-scanner 플러그인의 활성 스캐너로 다시 스캔 (커널은 스캐너 패키지에 의존하지 않는다)
          const mod = loader.plugins.get('engine-scanner')?.module as
            { activeScanner?: () => { scan(): Promise<EngineScanSnapshot> } | undefined } | undefined;
          const scanner = mod?.activeScanner?.();
          if (!scanner) throw new Error('engine-scanner 플러그인이 활성화돼 있지 않습니다');
          return scanner.scan();
        },
        loginStatus: (id) => getLoginStatus(id),
        adapters,
        pingCwd: workspace,
      },
      quota: {},
    });
  } catch (err) {
    process.stderr.write(`서버 기동 실패: ${err instanceof Error ? err.message : String(err)}\n`);
    log.close();
    return 1;
  }

  let reloader: HotReloader | undefined;
  if (!values['no-watch']) {
    reloader = new HotReloader(loader, { roots });
    reloader.on('reloaded', (e: { id: string; version: string }) =>
      process.stderr.write(`reloaded ${e.id}@${e.version}\n`),
    );
    reloader.on('failed', (e: { id: string; error: string }) =>
      process.stderr.write(`reload failed ${e.id}: ${e.error} (이전 버전 유지)\n`),
    );
    await reloader.start();
  }

  process.stdout.write(
    JSON.stringify({
      event: 'listening',
      url: server.url,
      port: server.port,
      tokenFile: server.tokenFile,
      plugins: active,
    }) + '\n',
  );

  const shutdown = async () => {
    await reloader?.stop();
    await server.close();
    log.close();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
  return new Promise<number>(() => {}); // 서버가 살아 있는 동안 대기
}

function isMainModule(): boolean {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}
const isMain = isMainModule();
if (isMain) {
  main().then(
    (code) => process.exit(code),
    (err: unknown) => {
      process.stderr.write(String(err instanceof Error ? (err.stack ?? err.message) : err) + '\n');
      process.exit(1);
    },
  );
}
