import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  GESTURE_KINDS,
  gestureTokenFrom,
  isGestureKind,
  type GestureKind,
  type HumanGestureTokens,
} from '../human-gesture-token.js';

/**
 * T-100 Part 2 설치 관리자 API (구현은 @harness-x/installer의 InstallService).
 *  POST /api/gesture-tokens {kind}                 — 화면의 실제 클릭 때만 호출 (1회용·60초)
 *  POST /api/install/search {query, kind?}         — 후보 찾기 (실행 없음)
 *  POST /api/install/resolve {url}                 — 주소 해석 → 후보·계획 (실행 없음)
 *  POST /api/install/plan {kind, target}           — 계획 만들기 (실행 없음)
 *  GET  /api/install/plans/:id                     — 계획 보기
 *  POST /api/install/execute {planId}              — 실행: 계획 종류에 맞는 클릭 토큰 필수(없으면 403)
 *  POST /api/install/cancel {jobId}                — 실행 취소
 *  POST /api/install/uninstall-plan {toolId}       — 제거 계획 (실행은 execute + uninstall 토큰)
 *  POST /api/install/updates                       — 업데이트 확인(조회만) → 업데이트 계획 목록
 *  POST /api/install/import/scan                   — 이미 있던 도구 찾기 (조회만)
 *  POST /api/install/import {ids}                  — 사용자가 고른 것만 등록 (import 토큰 필수)
 *  GET  /api/install/tools · /api/install/history  — 도구 목록 · installs.jsonl
 *  WS   /ws/install                                — 실행 출력 스트림 {type:'output', jobId, data}
 */

export interface InstallApprovalInfo {
  /** 사용한 클릭 토큰의 id (토큰 값은 넘기지 않는다) */
  gestureId: string;
}

export interface InstallOutputEvent {
  jobId: string;
  stream: 'stdout' | 'stderr' | 'info';
  data: string;
}

/** InstallService가 구현하는 API 면 (커널은 설치 관리자 패키지에 의존하지 않는다) */
export interface InstallApi {
  search(query: string, kind?: string): unknown;
  resolve(url: string): unknown;
  plan(req: Record<string, unknown>): unknown;
  getPlan(planId: string): unknown;
  /** 이 계획을 실행하려면 필요한 클릭 토큰 종류 (계획이 없으면 undefined) */
  gestureKindFor(planId: string): GestureKind | undefined;
  execute(planId: string, approval: InstallApprovalInfo): unknown;
  cancel(jobId: string): boolean;
  uninstallPlan(toolId: string): unknown;
  checkUpdates(): unknown;
  importScan(): unknown;
  importTools(ids: string[], approval: InstallApprovalInfo): unknown;
  tools(): unknown;
  history(): unknown;
  onOutput(cb: (ev: InstallOutputEvent) => void): () => void;
}

export interface InstallRoutesOptions {
  gestures: HumanGestureTokens;
  install?: InstallApi;
}

/** 서비스 오류 → 상태 코드 (err.status가 있으면 그대로, code NOT_FOUND → 404, 그 밖 400) */
function sendError(reply: FastifyReply, err: unknown) {
  const e = err as { status?: unknown; code?: unknown; message?: unknown };
  const status =
    typeof e.status === 'number' ? e.status : e.code === 'NOT_FOUND' ? 404 : e.code === 'BUSY' ? 409 : 400;
  return reply.code(status).send({
    error: typeof e.code === 'string' ? e.code : 'install_failed',
    message: err instanceof Error ? err.message : String(err),
  });
}

async function attempt(reply: FastifyReply, fn: () => unknown) {
  try {
    return await fn();
  } catch (err) {
    return sendError(reply, err);
  }
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');

export function registerGestureRoute(app: FastifyInstance, gestures: HumanGestureTokens): void {
  app.post('/api/gesture-tokens', async (req, reply) => {
    const kind = (req.body as { kind?: unknown } | undefined)?.kind;
    if (!isGestureKind(kind)) return reply.code(400).send({ error: 'invalid_kind', allowed: GESTURE_KINDS });
    return reply.code(201).send(gestures.issue(kind));
  });
}

export function registerInstallRoutes(app: FastifyInstance, o: InstallRoutesOptions): void {
  const svc = o.install;
  if (!svc) return;

  /** 클릭 토큰 확인. 실패하면 403을 보내고 undefined */
  const gesture = (
    headers: Record<string, unknown>,
    body: unknown,
    kind: GestureKind,
    reply: FastifyReply,
  ): InstallApprovalInfo | undefined => {
    const r = o.gestures.consume(gestureTokenFrom(headers, body), kind);
    if (r.ok) return { gestureId: r.id };
    void reply.code(403).send({ error: 'gesture_required', reason: r.reason, message: r.message });
    return undefined;
  };

  app.post('/api/install/search', async (req, reply) => {
    const b = (req.body ?? {}) as { query?: unknown; kind?: unknown };
    if (!str(b.query).trim()) return reply.code(400).send({ error: 'invalid_query' });
    return attempt(reply, () => svc.search(str(b.query), str(b.kind) || undefined));
  });

  app.post('/api/install/resolve', async (req, reply) => {
    const url = str((req.body as { url?: unknown } | undefined)?.url).trim();
    if (!url) return reply.code(400).send({ error: 'invalid_url', message: '주소를 넣어 주세요.' });
    return attempt(reply, () => svc.resolve(url));
  });

  app.post('/api/install/plan', async (req, reply) =>
    attempt(reply, () => svc.plan((req.body ?? {}) as Record<string, unknown>)),
  );

  app.get('/api/install/plans/:id', async (req, reply) => {
    const plan = svc.getPlan((req.params as { id: string }).id);
    return plan ? plan : reply.code(404).send({ error: 'not_found' });
  });

  app.post('/api/install/execute', async (req, reply) => {
    const planId = str((req.body as { planId?: unknown } | undefined)?.planId);
    const kind = planId ? svc.gestureKindFor(planId) : undefined;
    // 토큰 검사가 먼저: 계획이 없어도 토큰 없는 요청은 403
    const approval = gesture(req.headers, req.body, kind ?? 'install', reply);
    if (!approval) return reply;
    if (!kind) return reply.code(404).send({ error: 'not_found', message: '계획을 찾지 못했어요.' });
    return attempt(reply, async () => reply.code(202).send(await svc.execute(planId, approval)));
  });

  app.post('/api/install/cancel', async (req, reply) => {
    const jobId = str((req.body as { jobId?: unknown } | undefined)?.jobId);
    return svc.cancel(jobId) ? { cancelled: true } : reply.code(404).send({ error: 'not_found' });
  });

  app.post('/api/install/uninstall-plan', async (req, reply) =>
    attempt(reply, () => svc.uninstallPlan(str((req.body as { toolId?: unknown } | undefined)?.toolId))),
  );

  app.post('/api/install/updates', async (_req, reply) => attempt(reply, () => svc.checkUpdates()));
  app.post('/api/install/import/scan', async (_req, reply) => attempt(reply, () => svc.importScan()));
  app.post('/api/install/import', async (req, reply) => {
    const ids = (req.body as { ids?: unknown } | undefined)?.ids;
    const approval = gesture(req.headers, req.body, 'import', reply);
    if (!approval) return reply;
    if (!Array.isArray(ids) || !ids.every((x) => typeof x === 'string'))
      return reply.code(400).send({ error: 'invalid_ids' });
    return attempt(reply, () => svc.importTools(ids, approval));
  });

  app.get('/api/install/tools', async () => svc.tools());
  app.get('/api/install/history', async () => svc.history());

  app.get('/ws/install', { websocket: true }, (socket) => {
    const off = svc.onOutput((ev) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify({ type: 'output', ...ev }));
    });
    socket.on('close', off);
    socket.on('error', off);
  });
}
