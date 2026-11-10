#!/usr/bin/env node
import { existsSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { DEFAULT_API_PORT, startApiServer } from './api/server.js';
import { EventLog } from './event-log.js';
import { HookBus } from './hooks.js';
import { HotReloader } from './hot-reload.js';
import { PluginLoader, defaultPluginRoots, harnessHome } from './loader.js';
import { installTokenFileGuard } from './secrets.js';

/**
 * engine-scanner 플러그인 모듈의 공개 함수 (커널은 그 패키지에 의존하지 않는다 — 순환 방지.
 * 로드된 플러그인 모듈을 구조적으로 확인해 쓴다)
 */
interface ScannerPluginModule {
  activeScanner?(): { scan(): Promise<unknown> } | undefined;
  registerRescanRoute?(
    app: { post(path: string, handler: () => Promise<unknown>): unknown },
    scanner: { scan(): Promise<unknown> },
  ): void;
}

/** checklist-ledger 플러그인 모듈의 공개 함수 (T-028 28.1 GET /api/checklist/:session/status) */
interface LedgerPluginModule {
  workspaceLedgerResolver?(workspace: string): (sessionId: string) => unknown;
  registerChecklistStatusRoute?(app: unknown, resolve: (sessionId: string) => unknown): void;
}

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

  // 엔진 CLI 구독 토큰 파일을 하네스 프로세스가 읽지 못하게 막는다
  installTokenFileGuard();

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
  let server;
  try {
    server = await startApiServer({
      loader,
      log,
      host: values.host,
      port,
      routes: (app) => {
        const ledger = loader.plugins.get('checklist-ledger')?.module as LedgerPluginModule | undefined;
        if (values.workspace && ledger?.registerChecklistStatusRoute && ledger.workspaceLedgerResolver)
          ledger.registerChecklistStatusRoute(app, ledger.workspaceLedgerResolver(resolve(values.workspace)));
        // 핫리로드 뒤에도 현재 모듈의 스캐너를 쓰도록 요청 시점에 찾는다
        const mod = () => loader.plugins.get('engine-scanner')?.module as ScannerPluginModule | undefined;
        const register = mod()?.registerRescanRoute;
        if (!register) return;
        register(app, {
          scan: async () => {
            const s = mod()?.activeScanner?.();
            if (!s) throw new Error('engine-scanner가 활성 상태가 아닙니다');
            return s.scan();
          },
        });
      },
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
