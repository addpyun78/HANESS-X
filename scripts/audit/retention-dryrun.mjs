// C3.16 보관 정책 동작 여부: 기간 지난 테스트 데이터(임시 폴더)로 정리 함수(cleanupData)를 실행해 본다
// 실제 사용자 데이터는 건드리지 않는다(임시 프로젝트 폴더·가짜 세션 목록·기록 지우기는 세기만)
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { rawDir, root, writeJson } from './lib.mjs';
const { cleanupData } = await import(
  pathToFileURL(join(root, 'packages', 'kernel', 'dist', 'settings', 'data-cleanup.js')).href
);
const DAY = 86400000;
const now = Date.now();
const proj = mkdtempSync(join(tmpdir(), 'hx-retention-'));
const mk = (sid, h, ageDays) => {
  const d = join(proj, '.harness-x', 'attachments', sid, h);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'a.txt'), 'x');
  const t = (now - ageDays * DAY) / 1000;
  utimesSync(d, t, t);
};
mk('s-old', 'h1', 40);
mk('s-old', 'h2', 40);
mk('s-new', 'h3', 1);
const sessions = [
  { id: 'archived-old', archived: true, lastActivityAt: new Date(now - 100 * DAY).toISOString() },
  { id: 'archived-new', archived: true, lastActivityAt: new Date(now - 2 * DAY).toISOString() },
  { id: 'active-old', archived: false, lastActivityAt: new Date(now - 100 * DAY).toISOString() },
];
const removed = [];
const runWith = (values) =>
  cleanupData({
    values,
    sessions: () => sessions,
    removeLog: (id) => (removed.push(id), true),
    projectRoots: () => [proj],
    now: () => now,
  });
const def = runWith({});
const set = runWith({ data: { retentionDays: 30, attachmentsKeepDays: 7 } });
const result = {
  defaults: { result: def, note: '기본값(0)은 아무것도 지우지 않음' },
  withSettings: {
    values: { retentionDays: 30, attachmentsKeepDays: 7 },
    result: set,
    removedLogs: removed,
    keptNewAttachment: existsSync(join(proj, '.harness-x', 'attachments', 's-new', 'h3')),
    removedOldSessionDir: !existsSync(join(proj, '.harness-x', 'attachments', 's-old')),
  },
  notCovered: [
    '진행 중(보관 안 한) 작업의 기록은 기간이 지나도 남음(설계: 자동 삭제 금지 원칙)',
    '커널 자체 기록(logs/sessions/kernel/events.jsonl)·logs/index.sqlite 는 정리 대상 아님',
    '임시 작업 공간 정리 키 없음',
  ],
};
rmSync(proj, { recursive: true, force: true });
writeJson(join(rawDir, 'retention-dryrun.json'), result);
console.log(
  JSON.stringify({
    defaults: def,
    withSettings: set,
    removed,
    keptNew: result.withSettings.keptNewAttachment,
  }),
);
