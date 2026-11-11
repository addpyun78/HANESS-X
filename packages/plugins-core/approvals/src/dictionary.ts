import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  glossaryIndex,
  learnEquivalence,
  loadDefaultGlossary,
  loadGlossary,
  type Glossary,
  type WordAlias,
} from '@harness-x/checklist-ledger';
import { z } from 'zod';
import type { DifferenceKind } from './card.js';

/**
 * 사전 학습 (T-100 F.3)
 *   - 경로·이름 차이 → 프로젝트 glossary.json (단어 별칭, 판정 사다리와 같은 사전)
 *   - 텍스트·숫자 표현 차이 → equivalences.json (같은 뜻 표현 쌍)
 * 사람이 "같은 걸로 인정" + "다음부터 자동"을 골랐을 때(또는 F.4 제안에 "네")만 저장한다.
 */

export const EQUIVALENCES_FILE = 'equivalences.json';

export const EquivalencePairSchema = z
  .object({
    kind: z.string().min(1),
    a: z.string(),
    b: z.string(),
    addedAt: z.iso.datetime({ offset: true }),
    reason: z.string().optional(),
  })
  .strict();
export type EquivalencePair = z.infer<typeof EquivalencePairSchema>;

export const EquivalencesSchema = z
  .object({ version: z.literal(1), pairs: z.array(EquivalencePairSchema) })
  .strict();
export type Equivalences = z.infer<typeof EquivalencesSchema>;

/** 비교용 값 정리: NFC + 앞뒤 공백 + 연속 공백 1개 + 소문자 */
export function normalizeValue(v: string): string {
  return v.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** 순서와 무관한 쌍 키 */
export function pairKey(kind: string, a: string, b: string): string {
  const [x, y] = [normalizeValue(a), normalizeValue(b)].sort();
  return `${kind}\uE000${x}\uE000${y}`;
}

export function loadEquivalences(file: string): Equivalences {
  if (!existsSync(file)) return { version: 1, pairs: [] };
  return EquivalencesSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
}

function writeText(file: string, text: string): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}

export function hasEquivalence(file: string, kind: string, a: string, b: string): boolean {
  const key = pairKey(kind, a, b);
  return loadEquivalences(file).pairs.some((p) => pairKey(p.kind, p.a, p.b) === key);
}

/** 쌍 추가 (이미 있으면 false) */
export function addEquivalence(
  file: string,
  pair: { kind: string; a: string; b: string; reason?: string },
  now: Date = new Date(),
): boolean {
  if (hasEquivalence(file, pair.kind, pair.a, pair.b)) return false;
  const eq = loadEquivalences(file);
  eq.pairs.push(EquivalencePairSchema.parse({ ...pair, addedAt: now.toISOString() }));
  writeText(file, JSON.stringify(eq, null, 2) + '\n');
  return true;
}

// ── 사전 조회 ─────────────────────────────────────────────────────
export interface DictionaryFiles {
  /** 프로젝트 glossary.json (경로·이름) */
  glossaryFile?: string;
  /** equivalences.json (텍스트 표현) */
  equivalencesFile?: string;
}

export interface DictionaryMatch {
  source: 'glossary' | 'equivalences';
}

const splitExt = (seg: string): [string, string] => {
  const m = /^(.+?)(\.[A-Za-z0-9]+)$/.exec(seg);
  return m ? [m[1]!, m[2]!.toLowerCase()] : [seg, ''];
};

/** 경로 조각을 glossary canonical로 바꾼 비교 키 ("./하네스/모바일/" → "harness/mobile") */
export function canonicalPathKey(path: string, glossary: Glossary): string {
  const idx = glossaryIndex(glossary);
  return path
    .normalize('NFC')
    .replace(/\\/g, '/')
    .split('/')
    .filter((s) => s && s !== '.')
    .map((seg) => {
      const [base, ext] = splitExt(seg);
      return (idx.lookup(base) ?? base.toLowerCase()) + ext;
    })
    .join('/');
}

/** 같은 쌍이 사전에 있으면 매치 (판정 체인의 "사전" 단계가 부른다) */
export function dictionaryMatch(
  files: DictionaryFiles,
  input: { kind: DifferenceKind | string; expected: string; actual: string },
): DictionaryMatch | null {
  if (input.kind === 'path' && files.glossaryFile) {
    const g = existsSync(files.glossaryFile) ? loadGlossary(files.glossaryFile) : loadDefaultGlossary();
    if (canonicalPathKey(input.expected, g) === canonicalPathKey(input.actual, g))
      return { source: 'glossary' };
  }
  if (
    files.equivalencesFile &&
    hasEquivalence(files.equivalencesFile, input.kind, input.expected, input.actual)
  )
    return { source: 'equivalences' };
  return null;
}

// ── 저장 (+ 되돌리기용 스냅샷) ────────────────────────────────────────
export interface FileSnapshot {
  file: string;
  /** 저장 전 내용 (없던 파일이면 null) */
  before: string | null;
}

export function snapshotFile(file: string): FileSnapshot {
  return { file, before: existsSync(file) ? readFileSync(file, 'utf8') : null };
}

export function restoreSnapshot(s: FileSnapshot): void {
  if (s.before === null) rmSync(s.file, { force: true });
  else writeText(s.file, s.before);
}

export interface DictionarySaveResult {
  /** 어디에 저장했나 */
  target: 'glossary' | 'equivalences';
  /** 새로 들어간 단어 별칭 (glossary) */
  glossaryAliases: WordAlias[];
  /** 새로 들어간 표현 쌍 (equivalences) */
  added: boolean;
  /** 되돌리기 (H.23) */
  snapshots: FileSnapshot[];
}

/**
 * F.3 사전 저장. 경로 차이는 glossary(단어 별칭)로, 그 밖은 equivalences.json으로.
 * 경로인데 단어 별칭을 뽑을 수 없으면(조각 수가 다름 등) equivalences.json에 쌍으로 남긴다.
 */
export function saveToDictionary(
  files: DictionaryFiles,
  input: { kind: DifferenceKind | string; expected: string; actual: string; reason: string },
  now: Date = new Date(),
): DictionarySaveResult {
  const snapshots: FileSnapshot[] = [];
  if (input.kind === 'path' && files.glossaryFile) {
    snapshots.push(snapshotFile(files.glossaryFile));
    const learned = learnEquivalence({
      expectedPath: input.expected,
      actualPath: input.actual,
      reason: input.reason,
      glossaryFile: files.glossaryFile,
    });
    if (dictionaryMatch({ glossaryFile: files.glossaryFile }, input))
      return { target: 'glossary', glossaryAliases: learned.glossaryAliases, added: false, snapshots };
  }
  if (!files.equivalencesFile) throw new Error('equivalences.json 위치가 없어 사전에 저장할 수 없습니다');
  snapshots.push(snapshotFile(files.equivalencesFile));
  const added = addEquivalence(
    files.equivalencesFile,
    { kind: input.kind, a: input.expected, b: input.actual, reason: input.reason },
    now,
  );
  return { target: 'equivalences', glossaryAliases: [], added, snapshots };
}
