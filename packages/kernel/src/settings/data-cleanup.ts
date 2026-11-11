import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { readSetting } from './registry.js';

/**
 * T-101 6B.11 데이터 정리 — 설정 data.retentionDays·data.attachmentsKeepDays (0 = 지우지 않음, 기본).
 *  - 기록: "보관"한 작업 중 마지막 활동이 날수보다 오래된 것의 대화 기록(이벤트 기록)만 지운다.
 *    진행 중이거나 보관하지 않은 작업은 건드리지 않는다(0B.30 자동 삭제 금지 원칙).
 *  - 첨부: 프로젝트 폴더 안 `.harness-x/attachments/<세션>/<해시>/`(1A.2) 중 날수보다 오래된 사본.
 * 서버 시작 때 한 번, 그리고 설정 화면 [지금 정리하기](POST /api/settings/data/cleanup).
 */

export interface CleanupSession {
  id: string;
  archived: boolean;
  lastActivityAt: string;
}

export interface DataCleanupOptions {
  /** settings.json 값 */
  values: Record<string, unknown>;
  sessions: () => readonly CleanupSession[];
  /** 이벤트 기록 지우기 (EventLog.removeSession) */
  removeLog: (sessionId: string) => boolean;
  /** 프로젝트 폴더들 (폴더가 없는 프로젝트는 건너뜀) */
  projectRoots: () => readonly string[];
  now?: () => number;
}

export interface CleanupResult {
  /** 지운 작업 기록 수 */
  logs: number;
  /** 지운 첨부 사본 수 */
  attachments: number;
}

const DAY = 24 * 60 * 60 * 1000;

export function cleanupData(o: DataCleanupOptions): CleanupResult {
  const now = (o.now ?? Date.now)();
  const out: CleanupResult = { logs: 0, attachments: 0 };
  const keepLogs = readSetting<number>(o.values, 'data.retentionDays');
  if (keepLogs > 0) {
    const cut = now - keepLogs * DAY;
    for (const s of o.sessions())
      if (s.archived && Date.parse(s.lastActivityAt) < cut && o.removeLog(s.id)) out.logs++;
  }
  const keepFiles = readSetting<number>(o.values, 'data.attachmentsKeepDays');
  if (keepFiles > 0) {
    const cut = now - keepFiles * DAY;
    for (const root of o.projectRoots()) {
      const base = join(root, '.harness-x', 'attachments');
      if (!existsSync(base)) continue;
      for (const sid of safeList(base)) {
        const sdir = join(base, sid);
        for (const h of safeList(sdir)) {
          const hdir = join(sdir, h);
          try {
            if (statSync(hdir).mtimeMs < cut) {
              rmSync(hdir, { recursive: true, force: true });
              out.attachments++;
            }
          } catch {
            /* 이미 없음 */
          }
        }
        if (safeList(sdir).length === 0) rmSync(sdir, { recursive: true, force: true });
      }
    }
  }
  return out;
}

function safeList(dir: string): string[] {
  try {
    return statSync(dir).isDirectory() ? readdirSync(dir) : [];
  } catch {
    return [];
  }
}
