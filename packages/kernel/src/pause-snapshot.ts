import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import type { PausedInfo } from './stop.js';

/**
 * T-101 2A.6 정지 스냅샷
 * 세션이 멈출 때 paused{reason, at, by}, 현재 항목(interrupted: true), 파일 상태를 기록한다.
 * - Git 작업 폴더: `git stash create`로 작업 트리·인덱스·stash 목록을 바꾸지 않고 해시만 얻는다
 *   (stash create는 추적하지 않는 파일을 담지 않으므로 그 파일들은 경로+해시로 따로 적는다)
 * - Git이 아니면: 파일 목록 + 내용 해시(sha256)
 * 이어하기(2B.4)는 이 기록과 지금 상태를 비교해 "멈춘 뒤 바뀐 파일"을 찾는다.
 */

export interface FileHash {
  path: string;
  sha256: string;
}

export type FileState =
  | {
      kind: 'git';
      /** 멈춘 때의 HEAD (커밋이 없으면 null) */
      head: string | null;
      /** `git stash create` 해시 (바뀐 것이 없으면 null = HEAD 그대로) */
      stash: string | null;
      /** 추적하지 않는 파일 (stash create에 안 담김) */
      untracked: FileHash[];
    }
  | { kind: 'files'; files: FileHash[] };

export interface PauseSnapshot {
  sessionId: string;
  paused: PausedInfo;
  /** 멈출 때 하던 체크리스트 항목 */
  item?: { id: string; interrupted: true };
  /** 멈출 때 실행 중이던 노드 */
  nodeId?: string;
  cwd: string;
  files: FileState;
}

/** 해시를 셀 때 건너뛰는 폴더 */
const SKIP_DIRS = new Set(['.git', 'node_modules', '.harness-x', 'dist']);
/** 너무 큰 폴더 보호 */
const MAX_FILES = 20_000;

const sha256 = (buf: Buffer) => createHash('sha256').update(buf).digest('hex');
const toPosix = (p: string) => p.split(sep).join('/');

function git(cwd: string, args: string[]): string | null {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

export function isGitWorkTree(cwd: string): boolean {
  return git(cwd, ['rev-parse', '--is-inside-work-tree']) === 'true';
}

export function hashFile(abs: string): string {
  return sha256(readFileSync(abs));
}

/** Git이 아닌 폴더: 모든 파일의 경로+해시 (건너뛰는 폴더 제외) */
export function listFileHashes(root: string): FileHash[] {
  const out: FileHash[] = [];
  const walk = (dir: string) => {
    for (const d of readdirSync(dir, { withFileTypes: true })) {
      if (out.length >= MAX_FILES) return;
      const abs = join(dir, d.name);
      if (d.isDirectory()) {
        if (!SKIP_DIRS.has(d.name)) walk(abs);
      } else if (d.isFile()) out.push({ path: toPosix(relative(root, abs)), sha256: hashFile(abs) });
    }
  };
  walk(root);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

function untrackedHashes(cwd: string): FileHash[] {
  const list = git(cwd, ['ls-files', '--others', '--exclude-standard', '-z']) ?? '';
  return list
    .split('\0')
    .filter(Boolean)
    .filter((p) => existsSync(join(cwd, p)) && statSync(join(cwd, p)).isFile())
    .map((p) => ({ path: p, sha256: hashFile(join(cwd, p)) }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

/** 지금 파일 상태 (작업 트리를 바꾸지 않는다) */
export function captureFileState(cwd: string): FileState {
  if (isGitWorkTree(cwd)) {
    const head = git(cwd, ['rev-parse', '--verify', '-q', 'HEAD']) || null;
    const stash = head ? git(cwd, ['stash', 'create']) || null : null;
    return { kind: 'git', head, stash, untracked: untrackedHashes(cwd) };
  }
  return { kind: 'files', files: listFileHashes(cwd) };
}

export function pauseSnapshotFile(sessionDir: string): string {
  return join(sessionDir, 'pause.json');
}

export interface TakePauseSnapshotInput {
  sessionId: string;
  paused: PausedInfo;
  cwd: string;
  /** 스냅샷을 둘 세션 폴더 (예: dirname(log.sessionFile(id))) */
  sessionDir: string;
  itemId?: string;
  nodeId?: string;
}

/** 정지 스냅샷을 만들어 <세션 폴더>/pause.json에 쓴다 */
export function takePauseSnapshot(i: TakePauseSnapshotInput): PauseSnapshot {
  const snap: PauseSnapshot = {
    sessionId: i.sessionId,
    paused: i.paused,
    ...(i.itemId ? { item: { id: i.itemId, interrupted: true as const } } : {}),
    ...(i.nodeId ? { nodeId: i.nodeId } : {}),
    cwd: i.cwd,
    files: captureFileState(i.cwd),
  };
  const file = pauseSnapshotFile(i.sessionDir);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(snap, null, 2));
  return snap;
}

export function readPauseSnapshot(sessionDir: string): PauseSnapshot | null {
  const file = pauseSnapshotFile(sessionDir);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as PauseSnapshot;
  } catch {
    return null;
  }
}
