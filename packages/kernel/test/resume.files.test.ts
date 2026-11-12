import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkPlainKorean } from '@harness-x/approvals';
import { takePauseSnapshot } from '../src/pause-snapshot.js';
import { fileIssue } from '../src/resume-check.js';
import { diffSinceSnapshot, RevertNotSupportedError, revertToSnapshot } from '../src/resume-files.js';
import { tempDir } from './helpers.js';

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const temps: { cleanup(): void }[] = [];
afterEach(() => temps.splice(0).forEach((t) => t.cleanup()));
const tmp = () => {
  const t = tempDir('hx-rfiles-');
  temps.push(t);
  return t.dir;
};
const paused = { reason: 'user' as const, at: '2026-11-12T00:00:00.000Z', by: 'user' };

function repo() {
  const dir = tmp();
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 't@example.com');
  git(dir, 'config', 'user.name', 't');
  writeFileSync(join(dir, 'a.txt'), 'one\n');
  writeFileSync(join(dir, 'b.txt'), 'two\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-qm', 'init');
  return dir;
}

describe('2B.4 파일 변경 점검', () => {
  it('Git: 멈춘 뒤 고침·지움·새 파일 → 목록 + 쉬운 말 카드', () => {
    const dir = repo();
    writeFileSync(join(dir, 'a.txt'), 'paused\n');
    writeFileSync(join(dir, 'notes.md'), 'n\n');
    const snap = takePauseSnapshot({ sessionId: 's1', paused, cwd: dir, sessionDir: join(tmp(), 's1') });
    expect(diffSinceSnapshot(snap)).toEqual([]);
    // 사용자가 직접 고침
    writeFileSync(join(dir, 'a.txt'), 'user edit\n');
    rmSync(join(dir, 'b.txt'));
    writeFileSync(join(dir, 'new.txt'), 'new\n');
    writeFileSync(join(dir, 'notes.md'), 'n2\n');
    const changes = diffSinceSnapshot(snap);
    expect(changes).toEqual([
      { path: 'a.txt', change: 'modified' },
      { path: 'b.txt', change: 'deleted' },
      { path: 'new.txt', change: 'added' },
      { path: 'notes.md', change: 'modified' },
    ]);
    const card = fileIssue(changes, true);
    expect(card.list).toEqual([
      'a.txt (고쳐짐)',
      'b.txt (지워짐)',
      'new.txt (새로 생김)',
      'notes.md (고쳐짐)',
    ]);
    expect(checkPlainKorean(card.body).violations).toEqual([]);
  });

  it('Git: 멈춘 때로 되돌리기 → 되돌리기 전 지금 상태 백업이 존재', () => {
    const dir = repo();
    writeFileSync(join(dir, 'a.txt'), 'paused\n');
    const snap = takePauseSnapshot({ sessionId: 's1', paused, cwd: dir, sessionDir: join(tmp(), 's1') });
    writeFileSync(join(dir, 'a.txt'), 'user edit\n');
    rmSync(join(dir, 'b.txt'));
    writeFileSync(join(dir, 'new.txt'), 'new\n');
    const backupRoot = join(tmp(), 'backups');
    const r = revertToSnapshot(snap, { backupRoot, now: () => new Date('2026-11-13T00:00:00.000Z') });
    // 백업: 참조와 추적 안 하는 파일 복사본
    expect(r.backup.ref).toBe('refs/harness-x/backup/s1/2026-11-13T00-00-00-000Z');
    expect(git(dir, 'rev-parse', r.backup.ref)).toBe(r.backup.commit);
    expect(git(dir, 'show', `${r.backup.ref}:a.txt`)).toBe('user edit');
    expect(readFileSync(join(r.backup.untrackedDir, 'new.txt'), 'utf8')).toBe('new\n');
    expect(JSON.parse(readFileSync(r.backup.manifest, 'utf8'))).toMatchObject({
      sessionId: 's1',
      ref: r.backup.ref,
    });
    // 되돌림
    expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('paused\n');
    expect(readFileSync(join(dir, 'b.txt'), 'utf8')).toBe('two\n');
    expect(existsSync(join(dir, 'new.txt'))).toBe(false);
    expect(r.restored.sort()).toEqual(['a.txt', 'b.txt', 'new.txt']);
    expect(diffSinceSnapshot(snap)).toEqual([]);
    // stash 목록·HEAD는 그대로
    expect(git(dir, 'stash', 'list')).toBe('');
  });

  it('Git 아님: 목록은 만들지만 되돌리기는 안 됨 (카드에 되돌리기 선택지 없음)', () => {
    const dir = tmp();
    writeFileSync(join(dir, 'x.md'), 'x\n');
    const snap = takePauseSnapshot({ sessionId: 's2', paused, cwd: dir, sessionDir: join(tmp(), 's2') });
    writeFileSync(join(dir, 'x.md'), 'y\n');
    writeFileSync(join(dir, 'z.md'), 'z\n');
    expect(diffSinceSnapshot(snap)).toEqual([
      { path: 'x.md', change: 'modified' },
      { path: 'z.md', change: 'added' },
    ]);
    expect(() => revertToSnapshot(snap, { backupRoot: join(tmp(), 'b') })).toThrow(RevertNotSupportedError);
    expect(fileIssue(diffSinceSnapshot(snap), false).choices.map((c) => c.id)).toEqual(['keep', 'replan']);
  });
});
