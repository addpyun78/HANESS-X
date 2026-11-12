import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import websocket from '@fastify/websocket';
import { providedSlots, type AgentSummary } from '@harness-x/protocol';
import type { EventLog, LogRecord } from '../event-log.js';
import { harnessHome, type PluginLoader } from '../loader.js';
import {
  NativeFolderPicker,
  PickerBusyError,
  PickerUnsupportedError,
  singleFlight,
  type FolderPicker,
} from '../native/folder-picker.js';
import { WorkspaceRejectedError, WorkspaceStore } from '../workspaces.js';
import type { Dispatcher } from '../dispatch.js';
import { registerAgentSaveRoute, type SavedAgent } from './agents-routes.js';
import { registerSessionRoutes } from './sessions-routes.js';
import { registerEngineRoutes, type EnginesApiOptions } from './engines-routes.js';
import { registerQuotaRoute, type QuotaApiOptions } from './quota-route.js';
import { registerSettingsRoutes, type SettingsRoutesOptions } from './settings-routes.js';
import { registerTerminalRoute, type TerminalOptions } from './terminal.js';
import { registerApprovalRoutes, type ApprovalCardsApi, type ApprovalHandler } from './approvals-routes.js';
import { HumanGestureTokens } from '../human-gesture-token.js';
import { registerGestureRoute, registerInstallRoutes, type InstallApi } from './install-routes.js';
import { registerToolRoutes, type ToolFinderApi } from './tool-routes.js';
import { registerProjectRoutes, type ProjectRoutesOptions } from '../projects/routes.js';

/**
 * 로컬 API 서버
 * - 127.0.0.1(루프백)에만 바인딩. 그 외 주소는 기동 거부
 * - 실행마다 랜덤 세션 토큰 → ~/.harness-x/run/token (권한 600)
 * - 모든 요청에 토큰 필요 (Authorization: Bearer / x-harness-token, WebSocket은 ?token= 허용)
 * - Host 헤더 검사로 DNS 리바인딩 차단
 */

export const DEFAULT_API_PORT = 3790;
export const LOOPBACK_HOSTS = ['127.0.0.1', '::1', 'localhost'] as const;

export interface ApiServerOptions {
  loader: PluginLoader;
  log: EventLog;
  host?: string;
  port?: number;
  /** 토큰 파일 경로 (기본 ~/.harness-x/run/token) */
  tokenFile?: string;
  /** 테스트용 고정 토큰 */
  token?: string;
  logger?: boolean;
  /** GET /api/agents 제공자 (예: agent-builder 레지스트리). 없으면 빈 목록 */
  agents?: () => AgentSummary[] | Promise<AgentSummary[]>;
  /** 46.3 PUT /api/agents/:name 저장 위치의 하네스 홈 (기본 harnessHome() — HARNESS_X_HOME 존중) */
  agentsHome?: string;
  /** 에이전트 저장 뒤 알림 (예: 레지스트리 캐시 비우기) */
  onAgentSaved?: (saved: SavedAgent) => void;
  /** listen 전에 추가 라우트 등록 (예: engine-scanner의 POST /api/engines/rescan). 토큰 검사가 적용된다 */
  routes?: (app: FastifyInstance) => void | Promise<void>;
  /** 48.1 POST/GET /api/sessions (/ 실행 디스패치). 없으면 라우트 없음 */
  dispatch?: Dispatcher;
  /** POST /api/approvals/:id {decision} 처리기 (예: checklist-ledger Escalator). 없으면 404 */
  approvals?: ApprovalHandler;
  /** T-100 H.10 쉬운 말 승인 카드 (GET /api/approvals, POST /api/approvals/:id {choice, remember}) */
  approvalCards?: ApprovalCardsApi;
  /** POST /api/native/pick-folder 대화상자 (기본: NativeFolderPicker — Windows/WSL PowerShell) */
  folderPicker?: Pick<FolderPicker, 'pick'>;
  /** 교차 출처 허용 (데스크톱 웹뷰). 기본 Tauri 출처만 */
  corsOrigins?: string[];
  /** 워크스페이스 등록·최근 목록 (기본: ~/.harness-x/workspaces.json, 처음 쓸 때 만든다) */
  workspaces?: WorkspaceStore;
  /** 37.2 WS /ws/terminal (node-pty 셸, cwd = 워크스페이스). 없으면 라우트 없음 */
  terminal?: TerminalOptions;
  /** T-038 설정 > 엔진 API (/api/engines…). 없으면 라우트 없음 */
  engines?: EnginesApiOptions;
  /** T-101 0-1 설정 화면 API (/api/settings…). 없으면 라우트 없음 */
  settings?: SettingsRoutesOptions;
  /** T-060 GET /api/quota (엔진별 사용량 집계). 없으면 라우트 없음 */
  quota?: QuotaApiOptions;
  /** T-100 A.6 사람 클릭 토큰 저장소 (기본: 서버마다 새로). POST /api/gesture-tokens */
  gestures?: HumanGestureTokens;
  /** T-100 Part 2 설치 관리자 API (/api/install/…). 없으면 라우트 없음 */
  install?: InstallApi;
  /** T-100 Part 3 도구 찾기 API (/api/tools/…). 없으면 라우트 없음 */
  toolFinder?: ToolFinderApi;
  /** T-101 0-2 프로젝트·초안 세션 API (/api/projects…, POST /api/sessions {projectId?}). 없으면 라우트 없음 */
  projects?: ProjectRoutesOptions;
}

export {
  API_APPROVAL_DECISIONS,
  type ApiApprovalDecision,
  type ApprovalCardsApi,
  type ApprovalHandler,
} from './approvals-routes.js';

export interface ApiServer {
  app: FastifyInstance;
  token: string;
  tokenFile: string;
  url: string;
  port: number;
  /** 사람 클릭 토큰 저장소 (테스트·다른 라우트가 같은 저장소를 쓰도록 노출) */
  gestures: HumanGestureTokens;
  close(): Promise<void>;
}

/** 63.x Tauri 웹뷰 출처 (Windows: http(s)://tauri.localhost, macOS·Linux: tauri://localhost) */
export const TAURI_ORIGINS = ['http://tauri.localhost', 'https://tauri.localhost', 'tauri://localhost'];

export class BindRefusedError extends Error {
  constructor(host: string) {
    super(`외부 바인딩 금지: '${host}'. 하네스 API는 ${LOOPBACK_HOSTS.join(', ')}에만 바인딩합니다`);
  }
}

export function assertLoopback(host: string): void {
  if (!(LOOPBACK_HOSTS as readonly string[]).includes(host)) throw new BindRefusedError(host);
}

export function writeTokenFile(file: string, token: string): void {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, token + '\n', { mode: 0o600 });
  try {
    chmodSync(file, 0o600); // 기존 파일이 있던 경우에도 600 보장 (Windows에서는 무시됨)
  } catch {
    /* noop */
  }
}

export async function startApiServer(opts: ApiServerOptions): Promise<ApiServer> {
  const host = opts.host ?? '127.0.0.1';
  assertLoopback(host); // 8.1 — listen 전에 거부
  const token = opts.token ?? randomBytes(32).toString('base64url');
  const tokenFile = opts.tokenFile ?? join(harnessHome(), 'run', 'token');
  // T-102 I.2: 토큰 파일은 포트를 연 뒤에 쓴다 — 두 번째 serve가 포트 충돌로 실패해도 켜져 있던 서버의 토큰을 덮어쓰지 않게

  const app = Fastify({ logger: opts.logger ?? false });
  await app.register(websocket);

  let boundPort = opts.port ?? DEFAULT_API_PORT;

  const corsOrigins = new Set(opts.corsOrigins ?? TAURI_ORIGINS);

  // DNS 리바인딩 방지: Host 헤더가 루프백이어야 함
  app.addHook('onRequest', async (req, reply) => {
    const hostHeader = (req.headers.host ?? '').toLowerCase();
    const hostname = hostHeader.startsWith('[')
      ? hostHeader.slice(0, hostHeader.indexOf(']') + 1)
      : hostHeader.split(':')[0];
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(hostname ?? '')) {
      return reply.code(403).send({ error: 'forbidden_host' });
    }
    // 데스크톱 웹뷰(허용된 출처)만 CORS 허용. 사전 요청(OPTIONS)은 토큰 없이 응답
    const origin = req.headers.origin;
    if (origin && corsOrigins.has(origin)) {
      reply.header('access-control-allow-origin', origin);
      reply.header('vary', 'origin');
      if (req.method === 'OPTIONS') {
        return reply
          .code(204)
          .header('access-control-allow-methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
          .header('access-control-allow-headers', 'authorization, content-type, x-harness-token')
          .header('access-control-max-age', '600')
          .send();
      }
    }
    // 8.2 토큰 검사
    if (!checkToken(req, token)) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
  });

  app.get('/api/health', async () => ({ ok: true, port: boundPort }));

  // 8.3 플러그인 목록
  app.get('/api/plugins', async () => ({
    plugins: [...opts.loader.plugins.values()].map((p) => ({
      id: p.manifest.id,
      version: p.manifest.version,
      displayName: p.manifest.displayName ?? p.manifest.id,
      description: p.manifest.description,
      state: p.state,
      origin: p.origin,
      slots: providedSlots(p.manifest),
      provides: p.manifest.provides,
      ...(p.trust ? { trust: p.trust } : {}),
      ...(p.isolation ? { isolation: p.isolation } : {}),
      ...(p.error ? { error: p.error } : {}),
    })),
    rejected: opts.loader.rejections.map((r) => ({ id: r.id, dir: r.dir, reason: r.reason })),
  }));

  // 62.3 신뢰 등급 승격 (UI의 "신뢰" 버튼) → 메인 스레드로 다시 올림
  app.post('/api/plugins/:id/promote', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!opts.loader.plugins.has(id)) return reply.code(404).send({ error: 'not_found' });
    try {
      const trust = await opts.loader.promote(id);
      const p = opts.loader.plugins.get(id)!;
      return { id, trust, isolation: p.isolation, state: p.state };
    } catch (err) {
      return reply
        .code(409)
        .send({ error: 'promote_failed', message: err instanceof Error ? err.message : String(err) });
    }
  });

  // 43.5 에이전트 목록 (agent-builder가 제공)
  app.get('/api/agents', async () => ({ agents: opts.agents ? await opts.agents() : [] }));
  // 46.3 빌더 저장 → <home>/agents/<name>/agent.yaml + pipeline.yaml (P4-F.2 사람 클릭 토큰 save-agent 필수)
  const gestures = opts.gestures ?? new HumanGestureTokens();
  registerAgentSaveRoute(app, {
    home: () => opts.agentsHome ?? harnessHome(),
    gestures,
    ...(opts.onAgentSaved ? { onSaved: opts.onAgentSaved } : {}),
  });

  // 27.3 승인 카드 응답 {decision} · T-100 H.10 쉬운 말 카드 {choice, remember}
  registerApprovalRoutes(app, {
    ...(opts.approvals ? { legacy: opts.approvals } : {}),
    ...(opts.approvalCards ? { cards: opts.approvalCards } : {}),
  });

  // 34.2 네이티브 폴더 대화상자 — 동시 1개(34.8: 두 번째는 409), 취소는 {cancelled:true}(34.6)
  let picker: FolderPicker | undefined;
  app.post('/api/native/pick-folder', async (req, reply) => {
    const body = (req.body ?? {}) as { initialPath?: unknown };
    const initialPath =
      typeof body.initialPath === 'string' && body.initialPath.trim() ? body.initialPath : undefined;
    picker ??= singleFlight(opts.folderPicker ?? new NativeFolderPicker());
    if (picker.busy) return reply.code(409).send({ error: 'picker_busy' });
    try {
      const r = await picker.pick(initialPath ? { initialPath } : {});
      return r.cancelled ? { cancelled: true } : { cancelled: false, path: r.path };
    } catch (err) {
      if (err instanceof PickerBusyError) return reply.code(409).send({ error: 'picker_busy' });
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof PickerUnsupportedError)
        return reply.code(501).send({ error: 'unsupported_platform', message });
      return reply.code(500).send({ error: 'picker_failed', message });
    }
  });

  // 35.x 워크스페이스: 검증·등록·최근 목록·핀
  let store = opts.workspaces;
  const ws = () => (store ??= new WorkspaceStore());
  app.get('/api/workspaces', async () => {
    const current = ws().current();
    return { ...(current ? { current } : {}), recent: ws().recent(), cwd: ws().sessionCwd() };
  });
  app.post('/api/workspaces/open', async (req, reply) => {
    const { path } = (req.body ?? {}) as { path?: unknown };
    try {
      const workspace = ws().open(typeof path === 'string' ? path : '');
      return { workspace, recent: ws().recent() };
    } catch (err) {
      if (err instanceof WorkspaceRejectedError)
        return reply.code(400).send({ error: err.code, message: err.message });
      throw err;
    }
  });
  app.post('/api/workspaces/pin', async (req, reply) => {
    const { path, pinned } = (req.body ?? {}) as { path?: unknown; pinned?: unknown };
    try {
      return { recent: ws().pin(String(path ?? ''), pinned === true) };
    } catch (err) {
      if (err instanceof WorkspaceRejectedError)
        return reply.code(404).send({ error: err.code, message: err.message });
      throw err;
    }
  });

  if (opts.dispatch) registerSessionRoutes(app, opts.dispatch, opts.projects?.sessions);
  if (opts.projects) registerProjectRoutes(app, opts.projects);
  if (opts.terminal) registerTerminalRoute(app, opts.terminal);
  if (opts.engines) registerEngineRoutes(app, opts.engines);
  if (opts.quota) registerQuotaRoute(app, opts.log, opts.quota);
  if (opts.settings) registerSettingsRoutes(app, opts.settings);
  registerGestureRoute(app, gestures);
  registerInstallRoutes(app, { gestures, ...(opts.install ? { install: opts.install } : {}) });
  if (opts.toolFinder) registerToolRoutes(app, opts.toolFinder);

  // 8.4 이벤트 스트리밍
  app.get('/ws/events', { websocket: true }, (socket, req) => {
    const q = req.query as { sessionId?: string; type?: string };
    const off = opts.log.subscribe((rec: LogRecord) => {
      if (q.sessionId && rec.sessionId !== q.sessionId) return;
      if (q.type && rec.type !== q.type) return;
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(rec));
    });
    socket.on('close', off);
    socket.on('error', off);
    socket.send(JSON.stringify({ type: 'hello', ts: new Date().toISOString() }));
  });

  if (opts.routes) await opts.routes(app);

  await app.listen({ host, port: boundPort });
  writeTokenFile(tokenFile, token);
  const addr = app.server.address();
  if (addr && typeof addr === 'object') boundPort = addr.port;
  const urlHost = host === '::1' ? '[::1]' : host;
  return {
    app,
    token,
    tokenFile,
    port: boundPort,
    url: `http://${urlHost}:${boundPort}`,
    gestures,
    close: () => app.close(),
  };
}

function checkToken(req: FastifyRequest, token: string): boolean {
  const auth = req.headers.authorization;
  let given: string | undefined;
  if (auth?.startsWith('Bearer ')) given = auth.slice(7).trim();
  else if (typeof req.headers['x-harness-token'] === 'string') given = req.headers['x-harness-token'];
  else if (req.url.startsWith('/ws/')) {
    const q = req.query as { token?: unknown };
    if (typeof q.token === 'string') given = q.token;
  }
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}
