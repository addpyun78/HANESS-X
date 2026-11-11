import type { FastifyInstance } from 'fastify';
import type { EventLog } from '../event-log.js';
import { findResumableSessions, resumableForProject } from '../resume.js';

export interface ResumeRoutesOptions {
  log: EventLog;
}

/**
 * T-101 2B 이어하기 API
 * - GET /api/resume?projectId=…  → {sessions: ResumableSession[]} (프로젝트를 열면 "이어서 할 작업이 있어요")
 *   projectId가 없으면 모든 미완료 세션
 */
export function registerResumeRoutes(app: FastifyInstance, o: ResumeRoutesOptions): void {
  app.get('/api/resume', async (req) => {
    const { projectId } = (req.query ?? {}) as { projectId?: string };
    const all = findResumableSessions(o.log);
    return { sessions: projectId ? resumableForProject(all, projectId) : all };
  });
}
