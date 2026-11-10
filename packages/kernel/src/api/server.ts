import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import websocket from '@fastify/websocket';
import { providedSlots, type AgentSummary } from '@harness-x/protocol';
import type { EventLog, LogRecord } from '../event-log.js';
import { harnessHome, type PluginLoader } from '../loader.js';

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
  /** POST /api/approvals/:id 처리기 (예: checklist-ledger Escalator). 없으면 404 */
  approvals?: ApprovalHandler;
}

/** 승인 카드 버튼 (판정 사다리 L5): 동치 인정 / 이동 승인 / 실패 */
export const API_APPROVAL_DECISIONS = ['equivalent', 'move', 'fail'] as const;
export type ApiApprovalDecision = (typeof API_APPROVAL_DECISIONS)[number];

/**
 * 승인 요청 응답 처리기. 오류의 code가 APPROVAL_NOT_FOUND면 404, 그 밖의 오류는 409로 응답한다.
 */
export interface ApprovalHandler {
  resolve(approvalId: string, decision: ApiApprovalDecision, meta: { by: string }): unknown;
}

export interface ApiServer {
  app: FastifyInstance;
  token: string;
  tokenFile: string;
  url: string;
  port: number;
  close(): Promise<void>;
}

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
  writeTokenFile(tokenFile, token);

  const app = Fastify({ logger: opts.logger ?? false });
  await app.register(websocket);

  let boundPort = opts.port ?? DEFAULT_API_PORT;

  // DNS 리바인딩 방지: Host 헤더가 루프백이어야 함
  app.addHook('onRequest', async (req, reply) => {
    const hostHeader = (req.headers.host ?? '').toLowerCase();
    const hostname = hostHeader.startsWith('[')
      ? hostHeader.slice(0, hostHeader.indexOf(']') + 1)
      : hostHeader.split(':')[0];
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(hostname ?? '')) {
      return reply.code(403).send({ error: 'forbidden_host' });
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

  // 27.3 승인 카드 응답 {decision: equivalent|move|fail}
  app.post('/api/approvals/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!opts.approvals) return reply.code(404).send({ error: 'not_found' });
    const decision = (req.body as { decision?: unknown } | undefined)?.decision;
    if (typeof decision !== 'string' || !(API_APPROVAL_DECISIONS as readonly string[]).includes(decision))
      return reply.code(400).send({ error: 'invalid_decision', allowed: API_APPROVAL_DECISIONS });
    try {
      const result = await opts.approvals.resolve(id, decision as ApiApprovalDecision, { by: 'api' });
      return { id, decision, result };
    } catch (err) {
      const code = (err as { code?: unknown }).code;
      const message = err instanceof Error ? err.message : String(err);
      if (code === 'APPROVAL_NOT_FOUND') return reply.code(404).send({ error: 'not_found', message });
      return reply.code(409).send({ error: 'approval_failed', ...(code ? { code } : {}), message });
    }
  });

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

  await app.listen({ host, port: boundPort });
  const addr = app.server.address();
  if (addr && typeof addr === 'object') boundPort = addr.port;
  const urlHost = host === '::1' ? '[::1]' : host;
  return {
    app,
    token,
    tokenFile,
    port: boundPort,
    url: `http://${urlHost}:${boundPort}`,
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
