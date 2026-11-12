import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { checkPlainKorean } from '@harness-x/approvals';
import { EventLog } from '../src/event-log.js';
import { findResumableSessions } from '../src/resume.js';
import { staleCleanupSuggestion } from '../src/resume-cleanup.js';
import { tempDir } from './helpers.js';

const NOW = new Date('2026-11-12T12:00:00.000Z');
const tmp = tempDir('hx-cleanup-');
afterAll(() => tmp.cleanup());

describe('2B.13 30일 지난 미완료 세션 정리 제안 (자동 삭제 금지)', () => {
  it('30일 이상만 제안, 제안만 하고 아무것도 지우지 않음', () => {
    const log = new EventLog({ root: join(tmp.dir, 'logs') });
    const paused = (id: string, at: string) => {
      log.append({
        id: `${id}c`,
        ts: at,
        sessionId: id,
        type: 'session_created',
        agent: 'qa',
        command: '/qa',
      });
      log.append({
        id: `${id}p`,
        ts: at,
        sessionId: id,
        type: 'session_paused',
        paused: { reason: 'user', at, by: 'user' },
      });
    };
    paused('old', '2026-10-01T00:00:00.000Z');
    paused('edge', '2026-10-13T12:00:00.000Z'); // 정확히 30일
    paused('new', '2026-11-01T00:00:00.000Z');
    log.flush();
    const list = findResumableSessions(log);
    const s = staleCleanupSuggestion(list, NOW)!;
    expect(s.sessionIds.sort()).toEqual(['edge', 'old']);
    expect(s.body).toBe(
      '멈춘 지 30일이 지난 작업이 2개 있어요. 하나씩 보고 정리할까요? 직접 고르기 전에는 지우지 않아요.',
    );
    expect(s.choices.map((c) => c.label)).toEqual(['하나씩 보기', '나중에']);
    expect(checkPlainKorean(s.body).violations).toEqual([]);
    // 지운 것 없음
    for (const id of ['old', 'edge', 'new']) expect(existsSync(log.sessionFile(id))).toBe(true);
    expect(findResumableSessions(log)).toHaveLength(3);
    expect(
      staleCleanupSuggestion(
        list.filter((x) => x.sessionId === 'new'),
        NOW,
      ),
    ).toBeNull();
  });
});
