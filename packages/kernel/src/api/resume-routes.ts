import type { FastifyInstance } from 'fastify';
import type { EventLog } from '../event-log.js';
import { findResumableSessions, resumableForProject } from '../resume.js';
import { staleCleanupSuggestion } from '../resume-cleanup.js';
import { ResumeServiceError, type ResumeService, type ResumeStartChoices } from '../resume-service.js';
import { ResumeError } from '../resume-run.js';

export interface ResumeRoutesOptions {
  log: EventLog;
  /** 점검·이어하기 실행 (없으면 목록만) */
  service?: ResumeService;
}

/**
 * T-101 2B 이어하기 API
 * - GET /api/resume?projectId=…  → {sessions: ResumableSession[]} (프로젝트를 열면 "이어서 할 작업이 있어요")
 *   projectId가 없으면 모든 미완료 세션. 2B.13 30일 지난 세션이 있으면 cleanup 제안(삭제는 하지 않음)
 * - POST /api/resume/:id/check → 6가지 점검 결과 {ok, issues} (2B.3)
 * - POST /api/resume/:id {files?, engine?, version?} → 202 {mode, version, interrupted?} (이어서 실행)
 *   404 이어할 세션 없음, 409 먼저 대답할 확인 카드 있음 {issues}
 */
export function registerResumeRoutes(app: FastifyInstance, o: ResumeRoutesOptions): void {
  app.get('/api/resume', async (req) => {
    const { projectId } = (req.query ?? {}) as { projectId?: string };
    const all = findResumableSessions(o.log);
    const sessions = projectId ? resumableForProject(all, projectId) : all;
    return { sessions, cleanup: staleCleanupSuggestion(sessions) };
  });
  const svc = o.service;
  if (!svc) return;
  const fail = (reply: { code(n: number): { send(b: unknown): unknown } }, err: unknown) => {
    if (err instanceof ResumeServiceError)
      return reply
        .code(err.code === 'not_found' ? 404 : 409)
        .send({ error: err.code, message: err.message, ...(err.issues ? { issues: err.issues } : {}) });
    if (err instanceof ResumeError) return reply.code(409).send({ error: err.code, message: err.message });
    throw err;
  };
  app.post('/api/resume/:id/check', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      return svc.check(id);
    } catch (err) {
      return fail(reply, err);
    }
  });
  app.post('/api/resume/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = (req.body ?? {}) as Record<string, unknown>;
    const choices: ResumeStartChoices = {
      ...(b.files === 'keep' || b.files === 'revert' || b.files === 'replan' ? { files: b.files } : {}),
      ...(typeof b.engine === 'string' && b.engine ? { engine: b.engine } : {}),
      ...(b.version === 'pinned' || b.version === 'latest' ? { version: b.version } : {}),
    };
    try {
      const r = await svc.start(id, choices);
      return reply.code(202).send({
        sessionId: id,
        mode: r.mode,
        version: r.version,
        ...(r.interrupted ? { interrupted: r.interrupted } : {}),
        ...(r.revert ? { revert: { ref: r.revert.backup.ref, cannotRestore: r.revert.cannotRestore } } : {}),
      });
    } catch (err) {
      return fail(reply, err);
    }
  });
}
