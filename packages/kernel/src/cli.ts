#!/usr/bin/env node
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import type { AgentSummary, EngineAdapter, Pipeline } from '@harness-x/protocol';
import type { DispatchRunResult } from './dispatch.js';
import type { LogRecord } from './event-log.js';
import type { EngineScanSnapshot } from './api/engines-routes.js';
import type { ApprovalCardsApi } from './api/approvals-routes.js';
import { findUnfinishedSessions, registerRecoveryRoutes, type LedgerView } from './recover.js';
import { HumanGestureTokens } from './human-gesture-token.js';
import { Worker } from 'node:worker_threads';
import type { HotReloader as HotReloaderType } from './hot-reload.js';

// 무거운 모듈(fastify 등)은 main 안에서 동적으로 불러온다 → --exit-with-stdin 감시를 기동 초기에 건다
// (WSL /mnt/c 위에서는 모듈 로딩만 수십 초 걸린다). 값은 api/server.ts의 DEFAULT_API_PORT와 같다.
const DEFAULT_API_PORT = 3790;

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

/** forge 플러그인 모듈의 공개 함수 (T-051 /forge 실행 옵션, 카드 응답 라우트) */
interface ForgePluginModule {
  forgeRunnerOptionsFor?(input: {
    sessionId: string;
    request: string;
    workspace: string;
    engines: (id: string) => EngineAdapter | undefined;
    defaultEngine?: string;
    log: { append(rec: LogRecord): unknown };
  }): Record<string, unknown>;
  /** app: fastify 인스턴스 */
  registerForgeApi?(app: unknown, opts: { log: { append(rec: LogRecord): unknown } }): void;
}

/** checklist-ledger 플러그인 모듈의 공개 함수 (T-028 28.1 GET /api/checklist/:session/status) */
interface LedgerPluginModule {
  workspaceLedgerResolver?(workspace: string): (sessionId: string) => unknown;
  registerChecklistStatusRoute?(app: unknown, resolve: (sessionId: string) => unknown): void;
  /** T-036 GET /api/checklist/:session · POST /api/checklist/:session/lock (체크리스트 패널) */
  registerChecklistPlanRoutes?(
    app: unknown,
    resolve: (sessionId: string) => unknown,
    opts: { log: { append(e: never): unknown } },
  ): void;
}

/** approvals 플러그인 모듈의 공개 함수 (T-100 H.10 승인 카드 API, H.17 `harness-x approvals`) */
interface ApprovalsPluginModule {
  workspaceApprovals?(workspace: string, extra: { log?: { append(e: never): unknown } }): ApprovalCardsApi;
  approvalsCli?(
    argv: string[],
    io: { input: NodeJS.ReadableStream; output: NodeJS.WritableStream },
  ): Promise<number>;
}

/** 저장소의 plugins-core 플러그인 (빌드된 dist) — 커널은 그 패키지에 의존하지 않는다 */
async function loadCorePluginModule<T>(name: string): Promise<T | undefined> {
  const root = repoRoot();
  const file = root && join(root, 'packages', 'plugins-core', name, 'dist', 'index.js');
  if (!file || !existsSync(file)) return undefined;
  const { pathToFileURL } = await import('node:url');
  return (await import(pathToFileURL(file).href)) as T;
}

const loadApprovalsModule = () => loadCorePluginModule<ApprovalsPluginModule>('approvals');

/** installer 플러그인 모듈의 공개 함수 (T-100 P2-G.7 `harness-x install`·`harness-x tools`) */
interface InstallerPluginModule {
  installCli?(
    argv: string[],
    io: { input: NodeJS.ReadableStream; output: NodeJS.WritableStream },
  ): Promise<number>;
}

/**
 * 판정 사다리 모듈의 공개 함수 (T-100 Part 1: 비교기 → 사전 → judge 체인 → 승인 카드 연결,
 * J.6 시작 시 예전 판정 설정·키 정리 1회 + 패널 안내). 커널은 그 패키지에 의존하지 않는다 — 구조적으로만 본다.
 */
export interface JudgeRuntimeLike {
  readonly settingsError?: string;
  readonly cleanup: { deleted: string[]; migration: { migrated: boolean }; lockRemoved: string[] };
  notices(): unknown[];
}
export interface LadderRuntimeModule {
  startJudgeRuntime?(opts: {
    home: string;
    workspace?: string;
    log?: { append(e: never): unknown };
    secrets: { delete(account: string): boolean };
    removeLockEntries?: (ids: string[]) => string[];
    approvals?: () => unknown;
    judge: {
      listEngines(): Promise<unknown[]>;
      ollamaBaseUrl?: string;
      secretStore?: unknown;
    };
  }): JudgeRuntimeLike;
  registerJudgeRoutes?(app: unknown, rt: JudgeRuntimeLike): void;
  judgeEnginesFrom?(
    scan: unknown,
    opts: {
      authMode?: (id: string) => 'subscription' | 'apiKey' | undefined;
      loginState?: (id: string) => 'loggedIn' | 'loggedOut' | 'unknown' | undefined;
    },
  ): unknown[];
}

/** 저장소의 판정 사다리 모듈 (빌드된 dist, packages/plugins-core/verifiers/ladder) */
export async function loadLadderModule(root = repoRoot()): Promise<LadderRuntimeModule | undefined> {
  const file = root && join(root, 'packages', 'plugins-core', 'verifiers', 'ladder', 'dist', 'index.js');
  if (!file || !existsSync(file)) return undefined;
  const { pathToFileURL } = await import('node:url');
  return (await import(pathToFileURL(file).href)) as LadderRuntimeModule;
}

/** 로그인 상태 조회 캐시 (판정마다 상태 명령을 다시 돌리지 않는다) */
const LOGIN_CACHE_MS = 60_000;

/**
 * agent-builder 플러그인 모듈의 공개 API (커널은 그 패키지에 의존하지 않는다 — 순환 방지.
 * 로드된 플러그인 모듈을 구조적으로 확인해 쓴다)
 */
interface AgentBuilderPluginModule {
  AgentRegistry?: new (o: { plugins?: () => Iterable<unknown>; home?: string; workspace?: string }) => {
    summaries(): AgentSummary[];
    list(): unknown[];
    get(nameOrCommand: string):
      | {
          name: string;
          command: string;
          agent: {
            displayName: string;
            icon?: string;
            defaultEngine: string;
            status?: 'ready' | 'incomplete';
          };
          pipeline: Pipeline;
        }
      | undefined;
  };
  /** T-041 실행기 (48.1 디스패치가 쓴다) */
  PipelineRunner?: new (o: Record<string, unknown>) => {
    run(pipeline: Pipeline, input: unknown): Promise<DispatchRunResult>;
  };
  /** T-100 P4-A.12 GET /api/builder/inventory (+ engines.json 감시). 핫리로드는 attachHotReload로 연결 */
  registerBuilderInventory?: (
    app: { get(path: string, handler: () => Promise<unknown>): unknown },
    o: { plugins: () => Iterable<unknown>; agents?: () => unknown[]; home?: string; workspace?: string },
  ) => {
    attachHotReload(src: { on(event: string, fn: () => void): unknown }): void;
    get(): Promise<unknown>;
  };
  /** T-100 P4 대화로 만들기: /api/builder/design·edit·drafts + POST /api/agents/save(사람 클릭 토큰) */
  registerBuilderDesignerRoutes?: (
    app: unknown,
    o: {
      home: string;
      inventory: { get(): Promise<unknown> };
      gestures: HumanGestureTokens;
      agents: () => readonly { name: string; command: string }[];
    },
  ) => unknown;
}

const HELP = `harness-x — 엔진 중립 에이전트 하네스

사용법:
  harness-x serve [옵션]     로컬 API 서버 실행 (기본 127.0.0.1:${DEFAULT_API_PORT})
  harness-x approvals [--workspace <dir>] [--session <id>] [카드 번호 선택 번호]
                             확인이 필요한 카드를 글로 보고 번호로 고르기
  harness-x install <이름|주소>
                             설치 계획을 글로 보고 y/n으로 설치 (화면 없이)
  harness-x tools list       설치된 도구 목록
  harness-x tools allow <id> 새 도구 첫 실행을 앞으로 허락

옵션:
  --port <n>          포트 (기본 ${DEFAULT_API_PORT}, 0 = 임의)
  --host <h>          바인딩 주소 (루프백만 허용)
  --workspace <dir>   워크스페이스 폴더 (<dir>/.harness-x/plugins 탐색)
  --plugins <dir>     추가 플러그인 루트 (여러 번 가능)
  --no-watch          핫리로드 끄기
  --exit-with-stdin   stdin이 닫히면 종료 (데스크톱 앱 사이드카용)
  --token-file <f>    토큰 파일 경로 (기본 ~/.harness-x/run/token)
  환경 변수 HARNESS_X_TOKEN이 있으면 그 값을 세션 토큰으로 쓴다 (32자 이상)
  -h, --help          도움말
`;

/**
 * stdin EOF 감시. 모듈 로딩 중에는 메인 이벤트 루프가 막혀 있을 수 있으므로(WSL /mnt/c에서 수십 초)
 * 별도 스레드가 fd 0을 블로킹으로 읽는다. EOF면 메인에 알리고, 5초 안에 끝나지 않으면 프로세스를 강제 종료한다.
 */
const STDIN_WATCH = `
const { readSync } = require('node:fs');
const { parentPort } = require('node:worker_threads');
const buf = Buffer.alloc(4096);
const pause = new Int32Array(new SharedArrayBuffer(4));
for (;;) {
  let n;
  try { n = readSync(0, buf, 0, buf.length, null); }
  catch (e) { if (e && e.code === 'EAGAIN') { Atomics.wait(pause, 0, 0, 50); continue; } n = 0; }
  if (n === 0) break;
}
parentPort.postMessage('eof');
Atomics.wait(pause, 0, 0, 5000);
process.kill(process.pid, 'SIGKILL');
`;

function watchStdinEof(onEof: () => void): void {
  const w = new Worker(STDIN_WATCH, { eval: true });
  w.once('message', onEof);
  w.unref();
}

/** dist/cli.js → 저장소 루트 (packages/kernel/dist → ../../..) */
function repoRoot(): string | undefined {
  const guess = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');
  return existsSync(join(guess, 'pnpm-workspace.yaml')) ? guess : undefined;
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  // T-100 H.17 패널 없이 승인 카드 보기·고르기 (자체 옵션을 쓰므로 serve 옵션 해석 전에 넘긴다)
  if (argv[0] === 'approvals') {
    const mod = await loadApprovalsModule();
    if (!mod?.approvalsCli) {
      process.stderr.write('approvals 플러그인을 찾지 못했습니다 (pnpm -r build 필요)\n');
      return 1;
    }
    return mod.approvalsCli(argv.slice(1), { input: process.stdin, output: process.stdout });
  }
  // T-100 P2-G.7 화면 없이 설치: 계획 표시 → y/n 승인 (installer 플러그인의 installCli)
  if (argv[0] === 'install' || argv[0] === 'tools') {
    const mod = await loadCorePluginModule<InstallerPluginModule>('installer');
    if (!mod?.installCli) {
      process.stderr.write('installer 플러그인을 찾지 못했습니다 (pnpm -r build 필요)\n');
      return 1;
    }
    return mod.installCli(argv, { input: process.stdin, output: process.stdout });
  }
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      port: { type: 'string' },
      host: { type: 'string' },
      workspace: { type: 'string' },
      plugins: { type: 'string', multiple: true },
      'no-watch': { type: 'boolean' },
      'exit-with-stdin': { type: 'boolean' },
      'token-file': { type: 'string' },
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

  // 63.2 데스크톱 앱이 끝나면(파이프가 닫히면) 서버도 끝난다 — 기동 중이어도 곧바로 종료
  const life: { shutdown?: () => Promise<void> } = {};
  if (values['exit-with-stdin']) {
    watchStdinEof(() => (life.shutdown ? void life.shutdown() : process.exit(0)));
  }

  const [
    { startApiServer },
    { EventLog },
    { HookBus },
    { HotReloader },
    loaderMod,
    { WorkspaceStore },
    { wireInstaller, wireToolFinder },
  ] = await Promise.all([
    import('./api/server.js'),
    import('./event-log.js'),
    import('./hooks.js'),
    import('./hot-reload.js'),
    import('./loader.js'),
    import('./workspaces.js'),
    import('./install-wiring.js'),
  ]);
  const { PluginLoader, defaultPluginRoots, harnessHome } = loaderMod;

  // 엔진 CLI 구독 토큰 파일을 하네스 프로세스가 읽지 못하게 막는다
  const [{ installTokenFileGuard, SecretStore }, { getLoginStatus }] = await Promise.all([
    import('./secrets.js'),
    import('./auth-status.js'),
  ]);
  installTokenFileGuard();

  const home = harnessHome();
  const log = new EventLog({ root: join(home, 'logs') });
  const hooks = new HookBus({ log });
  const enginesCache = join(home, 'engines.json');

  // T-100 Part 1 판정 연결: 설정(~/.harness-x/settings.json judge.*) → 예전 판정 설정·키 정리 1회(J.6) →
  // judge 체인(engine-scanner 감지 + 로그인 상태). 플러그인을 읽기 전에 정리해 plugins.lock에서 예전 항목을 먼저 지운다.
  const { removeLockEntries, loadEnginesSettings } = await Promise.all([
    import('./loader.js'),
    import('./engines-settings.js'),
  ]).then(([l, e]) => ({
    removeLockEntries: l.removeLockEntries,
    loadEnginesSettings: e.loadEnginesSettings,
  }));
  const secrets = new SecretStore();
  let approvalCards: ApprovalCardsApi | undefined;
  const loginCache = new Map<string, { at: number; state: 'loggedIn' | 'loggedOut' | 'unknown' }>();
  const loginState = async (id: string) => {
    const hit = loginCache.get(id);
    if (hit && Date.now() - hit.at < LOGIN_CACHE_MS) return hit.state;
    const state = (await getLoginStatus(id).catch(() => ({ state: 'unknown' as const }))).state;
    loginCache.set(id, { at: Date.now(), state });
    return state;
  };
  const ladderMod = await loadLadderModule().catch((err: unknown) => {
    process.stderr.write(
      `판정 사다리 모듈을 읽지 못했습니다: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return undefined;
  });
  const judgeRuntime = ladderMod?.startJudgeRuntime?.({
    home,
    ...(values.workspace ? { workspace: resolve(values.workspace) } : {}),
    log: log as unknown as { append(e: never): unknown },
    secrets,
    removeLockEntries: (ids) => removeLockEntries(join(home, 'plugins.lock'), ids),
    approvals: () => approvalCards,
    judge: {
      listEngines: async () => {
        const scan = existsSync(enginesCache)
          ? (JSON.parse(readFileSync(enginesCache, 'utf8')) as EngineScanSnapshot)
          : null;
        let modes: Record<string, { mode: 'subscription' | 'apiKey' }> = {};
        try {
          modes = loadEnginesSettings().engines;
        } catch {
          modes = {};
        }
        const states = new Map<string, 'loggedIn' | 'loggedOut' | 'unknown'>();
        for (const e of scan?.engines ?? []) states.set(e.name, await loginState(e.name));
        return (
          ladderMod?.judgeEnginesFrom?.(scan, {
            authMode: (id) => modes[id]?.mode,
            loginState: (id) => states.get(id),
          }) ?? []
        );
      },
      ...(process.env.HARNESS_X_OLLAMA_URL ? { ollamaBaseUrl: process.env.HARNESS_X_OLLAMA_URL } : {}),
      secretStore: secrets,
    },
  });
  if (judgeRuntime?.settingsError) process.stderr.write(`${judgeRuntime.settingsError}\n`);
  if (judgeRuntime?.cleanup.migration.migrated)
    process.stderr.write(
      `예전 판정 설정을 judge.*로 옮겼습니다 (지운 키 ${judgeRuntime.cleanup.deleted.length}개, lock ${judgeRuntime.cleanup.lockRemoved.length}개)\n`,
    );
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

  // 61.1 크래시 복구: 마지막 턴 이벤트가 turn_end가 아닌 세션 → GET /api/recovery "이어서 하기" 카드
  const unfinished = findUnfinishedSessions(log);
  if (unfinished.length)
    process.stderr.write(
      `미종료 세션 ${unfinished.length}개: ${unfinished.map((u) => u.sessionId).join(', ')} (GET /api/recovery)\n`,
    );

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

  // 43.5/46.5 에이전트 레지스트리: 요청마다 agent-builder 플러그인 모듈로 새로 만든다(핫리로드된 모듈 사용,
  // 사용자·프로젝트 폴더를 매번 다시 읽음 → 빌더 저장 직후 / 목록에 나타난다). 커널은 agent-builder를 import하지 않는다.
  const builder = () => loader.plugins.get('agent-builder')?.module as AgentBuilderPluginModule | undefined;
  const registry = () => {
    const R = builder()?.AgentRegistry;
    return R
      ? new R({
          plugins: () => loader.plugins.values(),
          home,
          ...(values.workspace ? { workspace: resolve(values.workspace) } : {}),
        })
      : undefined;
  };
  const forge = () => loader.plugins.get('forge')?.module as ForgePluginModule | undefined;
  // 48.1 / 실행 디스패치: 칩 + 지시문 → 그 에이전트 파이프라인으로 새 세션 (PipelineRunner 주입)
  const { Dispatcher } = await import('./dispatch.js');
  const dispatch = new Dispatcher({
    log,
    engines: () => adapters().map((a) => a.id),
    resolve: (name) => {
      const a = registry()?.get(name);
      return a
        ? {
            name: a.name,
            command: a.command,
            displayName: a.agent.displayName,
            ...(a.agent.icon ? { icon: a.agent.icon } : {}),
            defaultEngine: a.agent.defaultEngine,
            ...(a.agent.status ? { status: a.agent.status } : {}),
            pipeline: a.pipeline,
          }
        : undefined;
    },
    run: async (i) => {
      const Runner = builder()?.PipelineRunner;
      if (!Runner) throw new Error('agent-builder 플러그인이 활성 상태가 아닙니다');
      const list = adapters();
      const fallback =
        i.agent.defaultEngine && i.agent.defaultEngine !== 'auto' ? i.agent.defaultEngine : list[0]?.id;
      const runner = new Runner({
        engines: (id: string) => list.find((a) => a.id === id),
        ...((i.modifiers.engine ?? fallback) ? { defaultEngine: i.modifiers.engine ?? fallback } : {}),
        workspace,
        sessionId: i.sessionId,
        log,
        onEvent: i.onEvent,
        signal: i.signal,
        // #strict: 출력 계약 재요청 없이 첫 불충족에서 멈춘다
        ...(i.modifiers.strict ? { maxContractRetries: 0 } : {}),
        resolveAgent: (name: string) => registry()?.get(name)?.pipeline,
        // T-051 /forge: Forge 플러그인이 엔진 래퍼·gate 판정(검사·샌드박스)·scaffold 체크리스트를 준다
        ...(i.pipeline.name === 'forge'
          ? (forge()?.forgeRunnerOptionsFor?.({
              sessionId: i.sessionId,
              request: i.prompt,
              workspace,
              engines: (id: string) => list.find((a) => a.id === id),
              ...((i.modifiers.engine ?? fallback) ? { defaultEngine: i.modifiers.engine ?? fallback } : {}),
              log,
            }) ?? {})
          : {}),
      });
      return runner.run(i.pipeline, i.prompt);
    },
  });
  // T-100 Part 2 설치 관리자: API(/api/install/…) + MCP 도구(install.search·resolve·plan, 같은 서비스) +
  // 새 도구 첫 실행 확인(permission-gate, <home>/tools/allowed.json) + 설치 도구 감지(읽기만)
  const installWiring = wireInstaller({ plugins: loader.plugins, hooks });
  // T-100 Part 3 도구 찾기: /api/tools/* + tools.request(MCP) + 도구 고르기 카드 이벤트 + 설치 후 자동 재개
  const toolWiring = installWiring
    ? wireToolFinder({ plugins: loader.plugins, service: installWiring.service, log })
    : undefined;
  let server;
  let inventory:
    | { attachHotReload(src: { on(event: string, fn: () => void): unknown }): void; get(): Promise<unknown> }
    | undefined;
  // T-100 사람 클릭 토큰: 설치(Part 2)와 에이전트 저장(P4-F.2)이 같은 저장소를 쓴다
  const gestures = new HumanGestureTokens();
  try {
    // 35.x 워크스페이스 저장소 (~/.harness-x/workspaces.json) — 새 세션 cwd·쓰기 경계의 기준
    const workspaces = new WorkspaceStore();
    const envToken = process.env.HARNESS_X_TOKEN;
    server = await startApiServer({
      loader,
      log,
      host: values.host,
      port,
      // 43.5/46.5 GET /api/agents: 요청마다 agent-builder 레지스트리가 사용자·프로젝트 폴더를 다시 읽는다
      // → 빌더 저장(PUT /api/agents/:name) 직후 목록에 나타난다
      agents: () => registry()?.summaries() ?? [],
      dispatch,
      agentsHome: home,
      gestures,
      // T-100 H.10 쉬운 말 승인 카드 (GET /api/approvals, POST /api/approvals/:id {choice, remember})
      ...(() => {
        const ap = loader.plugins.get('approvals')?.module as ApprovalsPluginModule | undefined;
        approvalCards =
          values.workspace && ap?.workspaceApprovals
            ? ap.workspaceApprovals(resolve(values.workspace), { log })
            : undefined;
        return approvalCards ? { approvalCards } : {};
      })(),
      routes: (app) => {
        // T-100 판정 연결: GET /api/notices (한 번만 보여 줄 안내) · POST /api/compare (비교 파이프라인)
        if (judgeRuntime) ladderMod?.registerJudgeRoutes?.(app, judgeRuntime);
        const ledger = loader.plugins.get('checklist-ledger')?.module as LedgerPluginModule | undefined;
        const ledgerFor =
          values.workspace && ledger?.workspaceLedgerResolver
            ? ledger.workspaceLedgerResolver(resolve(values.workspace))
            : undefined;
        if (ledgerFor && ledger?.registerChecklistStatusRoute)
          ledger.registerChecklistStatusRoute(app, ledgerFor);
        if (ledgerFor && ledger?.registerChecklistPlanRoutes)
          ledger.registerChecklistPlanRoutes(app, ledgerFor, { log });
        // T-051 Forge 카드 응답 (POST /api/forge/answers/:id)
        forge()?.registerForgeApi?.(app, { log });
        registerRecoveryRoutes(app, {
          log,
          ...(ledgerFor ? { ledgerFor: (id) => ledgerFor(id) as LedgerView | null } : {}),
        });
        // T-100 P4-A.12 자산 전수조사 (5분 캐시, 플러그인 핫리로드·엔진 재스캔 시 새 스냅샷)
        inventory = builder()?.registerBuilderInventory?.(app, {
          plugins: () => loader.plugins.values(),
          agents: () => registry()?.list() ?? [],
          home,
          workspace,
        });
        // T-100 P4 대화로 만들기 (설계 AI는 도구 없이 읽기 전용, 저장은 사람 클릭 토큰으로만)
        if (inventory)
          builder()?.registerBuilderDesignerRoutes?.(app, {
            home,
            inventory,
            gestures,
            agents: () => registry()?.summaries() ?? [],
          });
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
      workspaces,
      ...(envToken && envToken.length >= 32 ? { token: envToken } : {}),
      ...(values['token-file'] ? { tokenFile: resolve(values['token-file']) } : {}),
      // 37.2 터미널 셸 cwd = 현재 워크스페이스 (폴더 선택기로 바꾸면 다음 셸부터 반영)
      terminal: { cwd: () => workspaces.sessionCwd(workspace) },
      engines: {
        secrets,
        scan: () =>
          existsSync(enginesCache)
            ? (JSON.parse(readFileSync(enginesCache, 'utf8')) as EngineScanSnapshot)
            : null,
        // POST /api/engines/rescan은 위 routes의 engine-scanner registerRescanRoute가 맡는다 (중복 등록 방지)
        loginStatus: (id) => getLoginStatus(id),
        adapters,
        pingCwd: workspace,
      },
      quota: {},
      ...(installWiring ? { install: installWiring.install } : {}),
      ...(toolWiring ? { toolFinder: toolWiring.toolFinder } : {}),
    });
  } catch (err) {
    process.stderr.write(`서버 기동 실패: ${err instanceof Error ? err.message : String(err)}\n`);
    log.close();
    return 1;
  }

  let reloader: HotReloaderType | undefined;
  if (!values['no-watch']) {
    reloader = new HotReloader(loader, { roots });
    reloader.on('reloaded', (e: { id: string; version: string }) =>
      process.stderr.write(`reloaded ${e.id}@${e.version}\n`),
    );
    reloader.on('failed', (e: { id: string; error: string }) =>
      process.stderr.write(`reload failed ${e.id}: ${e.error} (이전 버전 유지)\n`),
    );
    inventory?.attachHotReload(reloader);
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

  const stop = async () => {
    dispatch.abortAll();
    await reloader?.stop();
    await server.close();
    log.close();
    process.exit(0);
  };
  life.shutdown = stop;
  process.once('SIGINT', () => void stop());
  process.once('SIGTERM', () => void stop());
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
