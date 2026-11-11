import { join } from 'node:path';
import type { InstallApi } from './api/install-routes.js';
import type { ToolFinderApi } from './api/tool-routes.js';
import type { LogRecord } from './event-log.js';
import type { BlockingHandler } from './hooks.js';
import { FirstRunAsker, type FirstRunRequest } from './tool-first-run-asker.js';

/**
 * T-100 Part 2 실제 앱 연결 (커널은 설치 관리자·mcp-host·permission-gate 패키지에 의존하지 않는다 —
 * 로드된 플러그인 모듈을 구조적으로 확인해 쓴다. 핫리로드 뒤에도 요청 시점의 모듈을 쓴다)
 *  1) API 서버: startApiServer({ install }) — /api/install/…
 *  2) MCP: mcp-host가 띄우는 하네스 MCP 서버에 install.search·resolve·plan (같은 InstallService → 계획 id 공유)
 *  3) permission-gate: 새로 설치한 도구의 첫 실행은 한 번 묻기 — 패널 카드(approval_request kind
 *     'tool.first-run')로 묻고 클릭을 기다린다(시간 초과 = 거부). "앞으로 허락"은 <home>/tools/allowed.json에 바로 기록
 *  4) 설치 도구 감지(읽기만)를 기동 때 한 번
 */

export interface InstallServiceLike extends InstallApi {
  home: string;
  detect?(): Promise<unknown>;
  registry: { list(): { id: string; name: string; command?: string; origin?: string }[] };
}

interface InstallerModule {
  activeInstallService?(): InstallServiceLike | undefined;
}
interface McpHostModule {
  setInstallToolsProvider?(p: Pick<InstallApi, 'search' | 'resolve' | 'plan'> | undefined): void;
}
interface PermissionGateModule {
  installToolFirstRunGate?(
    hooks: { onBlocking(name: 'tool.before', h: BlockingHandler, o?: Record<string, unknown>): () => void },
    opts: {
      tools: () => { id: string; name: string; command?: string }[];
      file: string;
      ask?: (req: {
        toolId: string;
        toolName: string;
        command: string;
      }) => Promise<'always' | 'once' | 'deny'>;
    },
  ): { dispose(): void };
}

export interface InstallWiringOptions {
  /** 로드된 플러그인 (PluginLoader.plugins) */
  plugins: { get(id: string): { module?: unknown } | undefined };
  hooks: { onBlocking(name: 'tool.before', h: BlockingHandler, o?: Record<string, unknown>): () => void };
  /** 설치 도구 감지를 건너뛴다 (테스트) */
  detect?: boolean;
  /** 첫 실행 확인 카드 이벤트 기록 (EventLog.append). 없으면 카드를 못 띄우므로 첫 실행은 거부 */
  log?: { append(ev: LogRecord): unknown };
  /** 첫 실행 확인 카드 대기 시간 (기본 5분, 지나면 거부) */
  firstRunTimeoutMs?: number;
}

export interface InstallWiring {
  /** startApiServer({ install })에 넘길 API (요청마다 현재 서비스로 위임) */
  install: InstallApi;
  /** 연결할 때의 InstallService (tool-finder 연결용) */
  service: InstallServiceLike;
  allowedFile: string;
  /** 첫 실행 확인 카드 (POST /api/install/first-run/:id가 답한다) */
  firstRun: FirstRunAsker;
  dispose(): void;
}

/** 설치 관리자가 활성 상태면 연결하고, 아니면 undefined */
export function wireInstaller(o: InstallWiringOptions): InstallWiring | undefined {
  const mod = <T>(id: string) => o.plugins.get(id)?.module as T | undefined;
  const current = () => mod<InstallerModule>('installer')?.activeInstallService?.();
  const first = current();
  if (!first) return undefined;
  const svc = () => {
    const s = current();
    if (!s)
      throw Object.assign(new Error('설치 관리자가 꺼져 있어요.'), { status: 503, code: 'INSTALLER_OFF' });
    return s;
  };
  const firstRun = new FirstRunAsker({
    ...(o.log ? { log: o.log } : {}),
    ...(o.firstRunTimeoutMs !== undefined ? { timeoutMs: o.firstRunTimeoutMs } : {}),
  });
  const install: InstallApi = {
    search: (q, k) => svc().search(q, k),
    resolve: (u) => svc().resolve(u),
    plan: (r) => svc().plan(r),
    getPlan: (id) => current()?.getPlan(id),
    gestureKindFor: (id) => current()?.gestureKindFor(id),
    execute: (id, a) => svc().execute(id, a),
    cancel: (id) => current()?.cancel(id) ?? false,
    uninstallPlan: (id) => svc().uninstallPlan(id),
    checkUpdates: () => svc().checkUpdates(),
    importScan: () => svc().importScan(),
    importTools: (ids, a) => svc().importTools(ids, a),
    tools: () => svc().tools(),
    history: () => svc().history(),
    onOutput: (cb) => first.onOutput(cb),
    firstRunAnswer: (id, choice) => firstRun.answer(id, choice),
    firstRunPending: () => firstRun.pending(),
  };
  // AI에게는 찾기·주소 해석·계획만 (A.7)
  mod<McpHostModule>('mcp-host')?.setInstallToolsProvider?.({
    search: install.search,
    resolve: install.resolve,
    plan: install.plan,
  });
  const allowedFile = join(first.home, 'tools', 'allowed.json');
  const gate = mod<PermissionGateModule>('permission-gate')?.installToolFirstRunGate?.(o.hooks, {
    // 새로 설치한 도구만 (이미 있던 도구를 가져온 것은 묻지 않는다)
    tools: () =>
      (current()?.registry.list() ?? [])
        .filter((t) => t.origin !== 'imported')
        .map((t) => ({ id: t.id, name: t.name, ...(t.command ? { command: t.command } : {}) })),
    file: allowedFile,
    // 카드를 띄울 곳이 있을 때만 묻는다 (없으면 permission-gate 기본 동작 = 거부 + `tools allow` 안내)
    ...(o.log ? { ask: (req: FirstRunRequest) => firstRun.ask(req) } : {}),
  });
  if (o.detect !== false) void first.detect?.().catch(() => {});
  return {
    install,
    service: first,
    allowedFile,
    firstRun,
    dispose: () => {
      gate?.dispose();
      firstRun.dispose();
      mod<McpHostModule>('mcp-host')?.setInstallToolsProvider?.(undefined);
    },
  };
}

// ── T-100 Part 3 도구 찾기 (tool-finder 플러그인) ─────────────────────────────
interface ToolFinderModule {
  ToolFinder?: new (o: Record<string, unknown>) => unknown;
  ToolNeedHub?: new (
    finder: unknown,
    onResult?: (r: { status: string } & Record<string, unknown>) => void,
  ) => { mcpProvider(): ToolsRequestProviderLike };
  AutoResume?: new (o: { registry: unknown; ledgers: () => readonly unknown[] }) => { start(): () => void };
  createToolFinderApi?(o: {
    finder: unknown;
    install: { plan(r: Record<string, unknown>): Promise<unknown> };
    auto?: unknown;
  }): ToolFinderApi;
}
interface ToolsRequestProviderLike {
  request(args: { capability: string; why?: string; itemId?: string }): unknown;
}
interface McpHostToolsModule {
  setToolsRequestProvider?(p: ToolsRequestProviderLike | undefined): void;
}
interface InstallerRunnerModule {
  createRunner?(platform: unknown): unknown;
}

/** 도구 고르기 카드 이벤트 종류 (웹 apps/web/src/panels/ToolPicker/model.ts TOOL_PICKER_KIND) */
export const TOOL_PICKER_EVENT_KIND = 'tool.picker';

export interface ToolFinderWiringOptions {
  plugins: InstallWiringOptions['plugins'];
  /** wireInstaller가 연결한 InstallService */
  service: InstallServiceLike;
  /** 도구 고르기 카드를 화면에 알릴 이벤트 기록 (EventLog.append) */
  log?: { append(ev: LogRecord): unknown };
  /** ToolFinder 옵션 덮어쓰기 (테스트: 검색 공급자 비우기 등) */
  finderOptions?: Record<string, unknown>;
}

export interface ToolFinderWiring {
  /** startApiServer({ toolFinder }) */
  toolFinder: ToolFinderApi;
  /** mcp-host tools.request 제공자 (ToolNeedHub.mcpProvider()) */
  mcpProvider: ToolsRequestProviderLike;
  dispose(): void;
}

/**
 * tool-finder가 활성 상태면: ToolFinder + ToolNeedHub(후보 결과 → approval_request kind 'tool.picker' 이벤트 →
 * 웹 도구 고르기 카드) + AutoResume(registry 구독 → 설치되면 기다리던 항목 재개) + /api/tools/* +
 * mcp-host tools.request. 설치 실행은 하지 않는다 (계획 카드의 [설치] + 클릭 토큰으로만).
 */
export function wireToolFinder(o: ToolFinderWiringOptions): ToolFinderWiring | undefined {
  const tf = o.plugins.get('tool-finder')?.module as ToolFinderModule | undefined;
  if (!tf?.ToolFinder || !tf.ToolNeedHub || !tf.createToolFinderApi) return undefined;
  const svc = o.service;
  const runner = (o.plugins.get('installer')?.module as InstallerRunnerModule | undefined)?.createRunner?.(
    (svc as { platform?: unknown }).platform,
  );
  const finder = new tf.ToolFinder({
    home: svc.home,
    registry: svc.registry,
    ...(runner ? { runner } : {}),
    ...(typeof globalThis.fetch === 'function' ? { fetch: globalThis.fetch.bind(globalThis) } : {}),
    ...o.finderOptions,
  });
  let seq = 0;
  const hub = new tf.ToolNeedHub(finder, (r) => {
    if (r.status !== 'candidates' || !o.log) return;
    seq += 1;
    const id = `tool-picker-${Date.now().toString(36)}-${seq}`;
    o.log.append({
      id,
      ts: new Date().toISOString(),
      sessionId: 'tools',
      type: 'approval_request',
      approvalId: id,
      kind: TOOL_PICKER_EVENT_KIND,
      title: '이 작업에 도구가 필요해요',
      detail: { result: r },
      options: ['install', 'url', 'skip'],
    } as LogRecord);
  });
  const auto = tf.AutoResume ? new tf.AutoResume({ registry: svc.registry, ledgers: () => [] }) : undefined;
  const stop = auto?.start();
  const toolFinder = tf.createToolFinderApi({
    finder,
    install: { plan: async (r) => svc.plan(r) },
    ...(auto ? { auto } : {}),
  });
  const mcpProvider = hub.mcpProvider();
  const host = o.plugins.get('mcp-host')?.module as McpHostToolsModule | undefined;
  host?.setToolsRequestProvider?.(mcpProvider);
  return {
    toolFinder,
    mcpProvider,
    dispose: () => {
      stop?.();
      host?.setToolsRequestProvider?.(undefined);
    },
  };
}
