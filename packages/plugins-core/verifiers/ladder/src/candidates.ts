import { glossaryIndex, type Glossary, type GlossaryIndex } from '@harness-x/checklist-ledger';
import type { FileChangeEvent } from '@harness-x/protocol';
import { aliasKeyOf } from './alias.js';
import { normalizePath, type NormalizeOptions } from './normalize.js';

/**
 * 판정 사다리 L3 — 후보 수집 (25.3)
 * 이번 세션 file_change 중에서 기대 경로와 basename이 비슷한(편집거리) 것, 확장자가 같은 것을 위로 올려
 * 상위 N개(기본 5)를 고른다. 디렉터리 산출물이면 변경 파일들의 상위 폴더를 후보로 본다.
 */

/** file_change 이벤트 또는 경로 문자열 */
export type FileChangeLike =
  string | (Pick<FileChangeEvent, 'path'> & Partial<Pick<FileChangeEvent, 'change' | 'fromPath'>>);

export interface Candidate {
  /** 후보 경로 (root 기준 상대 POSIX 경로, root 밖이면 정규 절대 키) */
  path: string;
  /** L2 키 기준 basename 편집거리 */
  distance: number;
  /** 0~1 (1 = basename 같음) */
  similarity: number;
  extMatch: boolean;
  /** 이 후보를 만든 변경 파일 수 (디렉터리 후보) */
  hits: number;
}

export interface CandidateOptions extends NormalizeOptions {
  kind: 'file' | 'dir';
  glossary: Glossary | GlossaryIndex;
  /** 작업 폴더 루트 — 상대 경로 기준이자 디렉터리 후보의 상한 */
  root?: string;
  /** 기본 5 */
  limit?: number;
}

/** Levenshtein 편집거리 */
export function editDistance(a: string, b: string): number {
  const A = [...a];
  const B = [...b];
  let prev = Array.from({ length: B.length + 1 }, (_, j) => j);
  for (let i = 1; i <= A.length; i++) {
    const cur = [i];
    for (let j = 1; j <= B.length; j++)
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (A[i - 1] === B[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[B.length]!;
}

function splitExt(name: string): [string, string] {
  const m = /^(.+?)(\.[A-Za-z0-9]+)$/.exec(name);
  return m ? [m[1]!, m[2]!.toLowerCase()] : [name, ''];
}

function basename(key: string): string {
  const i = key.lastIndexOf('/');
  return i < 0 ? key : key.slice(i + 1);
}

/** 정규 키 → root 기준 상대 경로 (root 밖이면 그대로) */
export function relativeKey(key: string, rootKey: string | undefined): string {
  if (!rootKey) return key;
  if (key === rootKey) return '';
  return key.startsWith(rootKey + '/') ? key.slice(rootKey.length + 1) : key;
}

export function changePath(c: FileChangeLike): string {
  return typeof c === 'string' ? c : c.path;
}

/** 삭제가 아닌 변경의 경로 목록 (중복 제거, 기록 순서 유지) */
export function changedPaths(changes: readonly FileChangeLike[]): string[] {
  const out: string[] = [];
  for (const c of changes) {
    if (typeof c !== 'string' && c.change === 'delete') continue;
    out.push(changePath(c));
  }
  return [...new Set(out)];
}

export function collectCandidates(
  expectedPath: string,
  changes: readonly FileChangeLike[],
  opts: CandidateOptions,
): Candidate[] {
  const idx = glossaryIndex(opts.glossary);
  const nopts: NormalizeOptions = { ...opts, ...(opts.root !== undefined ? { cwd: opts.root } : {}) };
  const rootKey =
    opts.root !== undefined ? normalizePath(opts.root, { ...nopts, cwd: undefined }) : undefined;
  const expKey = aliasKeyOf(relativeKey(normalizePath(expectedPath, nopts), rootKey), idx);
  const [expBase, expExt] = splitExt(basename(expKey));

  // 후보 경로 → 변경 파일 수
  const pool = new Map<string, number>();
  for (const p of changedPaths(changes)) {
    const rel = relativeKey(normalizePath(p, nopts), rootKey);
    if (rel === '') continue;
    if (opts.kind === 'file') pool.set(rel, (pool.get(rel) ?? 0) + 1);
    else {
      const segs = rel.split('/');
      // 파일 자신은 제외하고 상위 폴더들 (root 밖 절대 경로면 앞 '/'로 생기는 빈 조각 제외)
      for (let n = segs.length - 1; n >= 1; n--) {
        const dir = segs.slice(0, n).join('/');
        if (dir === '' || dir === '/mnt') continue;
        pool.set(dir, (pool.get(dir) ?? 0) + 1);
      }
    }
  }

  const out: Candidate[] = [];
  for (const [path, hits] of pool) {
    const [base, ext] = splitExt(basename(aliasKeyOf(path, idx)));
    const distance = editDistance(expBase, base);
    const len = Math.max([...expBase].length, [...base].length, 1);
    out.push({
      path,
      distance,
      similarity: Math.round((1 - distance / len) * 1000) / 1000,
      extMatch: ext === expExt,
      hits,
    });
  }
  out.sort(
    (a, b) =>
      Number(b.extMatch) - Number(a.extMatch) ||
      a.distance - b.distance ||
      b.hits - a.hits ||
      a.path.length - b.path.length ||
      a.path.localeCompare(b.path),
  );
  return out.slice(0, opts.limit ?? 5);
}
