import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { captureFileState, type FileHash, type PauseSnapshot } from './pause-snapshot.js';
import type { FileChangeLike } from './resume-check.js';

/**
 * T-101 2B.4 파일 변경 점검
 * 2A.6 정지 스냅샷과 지금 상태를 비교해 "멈춘 뒤 바뀐 파일" 목록을 만든다.
 * "멈춘 때로 되돌리기"는 Git일 때만, 되돌리기 전에 지금 상태를 백업한다
 * (Git 참조 refs/harness-x/backup/… + 추적하지 않는 파일 복사본).
 */

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function compareHashes(before: FileHash[], after: FileHash[]): FileChangeLike[] {
  const a = new Map(before.map((f) => [f.path, f.sha256]));
  const b = new Map(after.map((f) => [f.path, f.sha256]));
  const out: FileChangeLike[] = [];
  for (const [p, h] of b) {
    if (!a.has(p)) out.push({ path: p, change: 'added' });
    else if (a.get(p) !== h) out.push({ path: p, change: 'modified' });
  }
  for (const p of a.keys()) if (!b.has(p)) out.push({ path: p, change: 'deleted' });
  return out;
}

const STATUS: Record<string, FileChangeLike['change']> = {
  A: 'added',
  M: 'modified',
  D: 'deleted',
  T: 'modified',
};

/** 멈춘 뒤 바뀐 파일 (경로순). 작업 트리는 바꾸지 않는다 */
export function diffSinceSnapshot(snap: PauseSnapshot, cwd = snap.cwd): FileChangeLike[] {
  const now = captureFileState(cwd);
  let out: FileChangeLike[] = [];
  if (snap.files.kind === 'git' && now.kind === 'git') {
    const from = snap.files.stash ?? snap.files.head;
    const to = now.stash ?? now.head;
    if (from && to && from !== to) {
      const lines = git(cwd, ['diff', '--name-status', '--no-renames', '-z', from, to]).split('\0');
      for (let i = 0; i + 1 < lines.length; i += 2) {
        const change = STATUS[lines[i]!.charAt(0)];
        if (change) out.push({ path: lines[i + 1]!, change });
      }
    }
    out.push(...compareHashes(snap.files.untracked, now.untracked));
  } else if (snap.files.kind === 'files' && now.kind === 'files') {
    out = compareHashes(snap.files.files, now.files);
  }
  const seen = new Set<string>();
  return out
    .filter((c) => (seen.has(c.path) ? false : (seen.add(c.path), true)))
    .sort((x, y) => x.path.localeCompare(y.path));
}

export interface RevertResult {
  /** 되돌리기 전 지금 상태 백업 */
  backup: { ref: string; commit: string; untrackedDir: string; manifest: string };
  /** 멈춘 때 내용으로 되돌린 파일 */
  restored: string[];
  /** 내용이 기록되지 않아 되돌릴 수 없는 파일 (추적하지 않는 파일이 그 뒤 고쳐지거나 지워짐) */
  cannotRestore: string[];
}

export class RevertNotSupportedError extends Error {
  constructor() {
    super('멈춘 때로 되돌리기는 Git으로 관리하는 폴더에서만 할 수 있어요.');
    this.name = 'RevertNotSupportedError';
  }
}

/**
 * 멈춘 때로 되돌리기 (Git만). 먼저 지금 상태를 백업한 뒤
 * 추적 파일은 스냅샷 내용으로, 그 뒤 새로 생긴 추적 안 하는 파일은 지운다(백업에 복사본 있음).
 */
export function revertToSnapshot(
  snap: PauseSnapshot,
  opts: { backupRoot: string; cwd?: string; now?: () => Date },
): RevertResult {
  const cwd = opts.cwd ?? snap.cwd;
  const now = captureFileState(cwd);
  if (snap.files.kind !== 'git' || now.kind !== 'git') throw new RevertNotSupportedError();
  const target = snap.files.stash ?? snap.files.head;
  if (!target || !now.head) throw new RevertNotSupportedError();
  const changes = diffSinceSnapshot(snap, cwd);

  // 1) 백업: 지금 작업 트리(추적 파일) 커밋을 참조로 고정 + 추적 안 하는 파일 복사
  const stamp = (opts.now?.() ?? new Date()).toISOString().replace(/[:.]/g, '-');
  const commit = now.stash ?? now.head;
  const ref = `refs/harness-x/backup/${snap.sessionId}/${stamp}`;
  git(cwd, ['update-ref', ref, commit]);
  const untrackedDir = join(opts.backupRoot, stamp, 'untracked');
  for (const f of now.untracked) {
    const dst = join(untrackedDir, f.path);
    mkdirSync(dirname(dst), { recursive: true });
    copyFileSync(join(cwd, f.path), dst);
  }
  const manifest = join(opts.backupRoot, stamp, 'backup.json');
  mkdirSync(dirname(manifest), { recursive: true });
  writeFileSync(
    manifest,
    JSON.stringify({ sessionId: snap.sessionId, ref, commit, untracked: now.untracked, changes }, null, 2),
  );

  // 2) 되돌리기
  git(cwd, ['restore', `--source=${target}`, '--worktree', '--', '.']);
  const pausedUntracked = new Map(snap.files.untracked.map((f) => [f.path, f.sha256]));
  const restored: string[] = [];
  const cannotRestore: string[] = [];
  for (const c of changes) {
    if (pausedUntracked.has(c.path)) {
      cannotRestore.push(c.path); // 추적 안 하던 파일의 내용은 기록되지 않았다
      continue;
    }
    const abs = join(cwd, c.path);
    // 멈춘 뒤 새로 생긴 추적 안 하는 파일 → 지운다 (백업에 있음)
    if (c.change === 'added' && now.untracked.some((u) => u.path === c.path) && existsSync(abs))
      rmSync(abs, { force: true });
    restored.push(c.path);
  }
  return { backup: { ref, commit, untrackedDir, manifest }, restored, cannotRestore };
}
