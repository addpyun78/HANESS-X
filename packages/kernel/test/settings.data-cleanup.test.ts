import { existsSync, mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EventLog } from '../src/event-log.js';
import { cleanupData, type CleanupSession } from '../src/settings/data-cleanup.js';
import { tempDir, textEvent } from './helpers.js';
import { bootSettings } from './settings-screen-fixtures.js';

/** T-101 6B.11 기록 보관 기간·첨부 정리 (설정 data.retentionDays·data.attachmentsKeepDays, 0 = 지우지 않음) */

const NOW = Date.parse('2026-11-12T00:00:00.000Z');
const DAY = 86_400_000;
let t: ReturnType<typeof tempDir>;
beforeEach(() => {
  t = tempDir('hx-cleanup-');
});
afterEach(() => t.cleanup());

function attachment(root: string, sid: string, hash: string, ageDays: number) {
  const d = join(root, '.harness-x', 'attachments', sid, hash);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, '원본'), 'x');
  const at = new Date(NOW - ageDays * DAY);
  utimesSync(d, at, at);
  return d;
}

describe('6B.11 데이터 정리', () => {
  it('기본값(0)이면 아무것도 지우지 않는다', () => {
    const root = join(t.dir, 'p');
    const a = attachment(root, 's1', 'old', 400);
    let removed = 0;
    const r = cleanupData({
      values: {},
      sessions: () => [{ id: 's1', archived: true, lastActivityAt: '2020-01-01T00:00:00.000Z' }],
      removeLog: () => (removed++, true),
      projectRoots: () => [root],
      now: () => NOW,
    });
    expect(r).toEqual({ logs: 0, attachments: 0 });
    expect(removed).toBe(0);
    expect(existsSync(a)).toBe(true);
  });

  it('보관한 작업 중 오래된 것의 기록만, 오래된 첨부 사본만 지운다', () => {
    const log = new EventLog({ root: join(t.dir, 'logs') });
    for (const id of ['old-archived', 'old-active', 'new-archived']) log.append(textEvent(id, '안녕'));
    log.flush();
    const sessions: CleanupSession[] = [
      { id: 'old-archived', archived: true, lastActivityAt: new Date(NOW - 40 * DAY).toISOString() },
      { id: 'old-active', archived: false, lastActivityAt: new Date(NOW - 40 * DAY).toISOString() },
      { id: 'new-archived', archived: true, lastActivityAt: new Date(NOW - 5 * DAY).toISOString() },
    ];
    const root = join(t.dir, 'p');
    const old = attachment(root, 's1', 'aaa', 20);
    const fresh = attachment(root, 's1', 'bbb', 2);
    const lone = attachment(root, 's2', 'ccc', 20);
    const r = cleanupData({
      values: { data: { retentionDays: 30, attachmentsKeepDays: 10 } },
      sessions: () => sessions,
      removeLog: (id) => log.removeSession(id),
      projectRoots: () => [root, join(t.dir, 'missing')],
      now: () => NOW,
    });
    expect(r).toEqual({ logs: 1, attachments: 2 });
    expect(log.sessions()).toEqual(['new-archived', 'old-active']);
    expect(existsSync(log.sessionFile('old-archived'))).toBe(false);
    expect(existsSync(old)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
    expect(existsSync(lone)).toBe(false);
    expect(existsSync(join(root, '.harness-x', 'attachments', 's2'))).toBe(false);
    log.close();
  });

  it('API [지금 정리하기]: POST /api/settings/data/cleanup (없으면 404)', async () => {
    const none = await bootSettings();
    try {
      expect((await none.req('POST', '/api/settings/data/cleanup')).status).toBe(404);
    } finally {
      await none.close();
    }
    const b = await bootSettings({ cleanup: () => ({ logs: 2, attachments: 3 }) });
    try {
      expect((await b.req('POST', '/api/settings/data/cleanup')).body).toEqual({
        ok: true,
        logs: 2,
        attachments: 3,
      });
    } finally {
      await b.close();
    }
  });
});
