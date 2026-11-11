import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import {
  defaultCompareCtx,
  EMPTY_EQUIVALENCES,
  pathComparator,
  type CompareCtx,
  type Equivalences,
} from '@harness-x/comparators';
import {
  glossaryIndex,
  type Acceptance,
  type Glossary,
  type GlossaryIndex,
  type VerdictKind,
} from '@harness-x/checklist-ledger';
import {
  changedPaths,
  collectCandidates,
  relativeKey,
  type Candidate,
  type FileChangeLike,
} from './candidates.js';
import {
  checkContentEvidence,
  defaultAcceptanceRunner,
  type AcceptanceOutcome,
  type AcceptanceRunner,
} from './evidence.js';
import { aliasKeyOf } from './alias.js';
import { normalizePath, toPosixForm, type NormalizeOptions } from './normalize.js';

/**
 * 판정 사다리 L1~L3 (코드 판정, 모델 호출 0회)
 *   L1 정규화 → L2 별칭 → (기대 경로 디스크 확인) → L3 후보 수집 + 내용 증거
 * 확정되는 칸에서 멈춘다. L3에서 "위치만 다름(relocated)"이면 escalate=true로 L4(판정 모델)에 넘긴다.
 */

export type LadderLevel = 1 | 2 | 3;

export interface LadderExpected {
  /** manifest 정식 경로 또는 항목이 적은 경로 (root 기준 상대 또는 절대, 표시 이름 허용) */
  path: string;
  kind: 'file' | 'dir';
  /** manifest에 등록된 동치 경로 (L2에서 비교) */
  aliases?: readonly string[];
}

export interface LadderInput {
  expected: LadderExpected;
  /** 이번 세션 file_change (이벤트 또는 경로) */
  changes: readonly FileChangeLike[];
  /** 항목 acceptance — L3 내용 증거에서 후보 경로로 재실행 */
  acceptance: readonly Acceptance[];
  /** 작업 폴더 루트 */
  root: string;
  glossary: Glossary | GlossaryIndex;
  runner?: AcceptanceRunner;
  normalize?: Omit<NormalizeOptions, 'cwd'>;
  /** L3 후보 수 (기본 5) */
  candidateLimit?: number;
  /** 기대 경로가 디스크에 이미 있으면 L1 동치로 본다 (기본 true) */
  checkDisk?: boolean;
  /** 사전 허용 규칙·동치 쌍 (T-100 C.3, 기본 없음) */
  equivalences?: Equivalences;
}

export interface LadderResult {
  level: LadderLevel;
  verdict: VerdictKind;
  /** 0~1 */
  confidence: number;
  reason: string;
  /** 기대 경로 (정규 키, root 기준 상대) */
  expectedPath: string;
  /** 판정에 쓰인 실제 경로 (정규 키, root 기준 상대) */
  actualPath?: string;
  /** L3에서 검토한 후보 (L1·L2에서 끝나면 빈 배열) */
  candidates: Candidate[];
  /** L3 내용 증거 결과 (actualPath 또는 마지막 후보) */
  checks?: AcceptanceOutcome[];
  /** 상위 칸(L4 판정 모델)으로 넘겨야 하는가 */
  escalate: boolean;
}

/**
 * 관찰된 경로 key가 기대 경로 target과 같은가 — path 비교기(T-100 C.2)로 판정한다.
 * 파일은 경로 전체, 디렉터리는 실제 경로에서 기대 경로 깊이만큼의 앞부분을 비교한다.
 * level=normalize: 정규화 칸만(L1), dictionary: glossary·사전 규칙까지(L2)
 */
function matchPrefix(
  key: string,
  target: string,
  kind: 'file' | 'dir',
  level: 'normalize' | 'dictionary',
  ctx: CompareCtx,
): string | null {
  const depth = target === '' ? 0 : target.split('/').length;
  const parts = key.split('/');
  if (kind === 'dir' && parts.length < depth) return null;
  const actual = kind === 'file' ? key : parts.slice(0, depth).join('/');
  const r = pathComparator.equals(target, actual, ctx, {
    cwd: null,
    caseInsensitive: false,
    dictionary: level === 'dictionary',
  });
  return r.verdict === 'equal' ? actual : null;
}

export async function runLadder(input: LadderInput): Promise<LadderResult> {
  const idx = glossaryIndex(input.glossary);
  const nopts: NormalizeOptions = { ...input.normalize, cwd: input.root };
  const rootKey = normalizePath(input.root, { ...input.normalize });
  const keyOf = (p: string) => relativeKey(normalizePath(p, nopts), rootKey);
  const expKey = keyOf(input.expected.path);
  const aliasKeys = (input.expected.aliases ?? []).map(keyOf);
  const observed = changedPaths(input.changes).map(keyOf);
  const base = { expectedPath: expKey, candidates: [] as Candidate[], escalate: false };
  const ctx = defaultCompareCtx({
    os: 'posix',
    workspaceRoot: input.root,
    glossary: idx,
    equivalences: input.equivalences ?? EMPTY_EQUIVALENCES,
  });

  // L1 정규화
  for (const key of observed) {
    const hit = matchPrefix(key, expKey, input.expected.kind, 'normalize', ctx);
    if (hit !== null)
      return {
        ...base,
        level: 1,
        verdict: 'equal',
        confidence: 1,
        reason: '정규화 후 경로 일치',
        actualPath: hit,
      };
  }
  if (input.checkDisk ?? true) {
    const abs = isAbsolute(toPosixForm(expKey)) ? expKey : join(toPosixForm(input.root), expKey);
    if (existsSync(abs))
      return {
        ...base,
        level: 1,
        verdict: 'equal',
        confidence: 1,
        reason: '기대 경로에 산출물 존재',
        actualPath: expKey,
      };
  }

  // L2 별칭 사전 (glossary 단어 치환 + manifest 별칭 경로)
  for (const key of observed) {
    for (const target of [expKey, ...aliasKeys]) {
      const hit = matchPrefix(key, target, input.expected.kind, 'dictionary', ctx);
      if (hit !== null)
        return {
          ...base,
          level: 2,
          verdict: 'equal',
          confidence: 1,
          reason:
            target === expKey
              ? `glossary 별칭 치환 후 경로 일치 (${aliasKeyOf(expKey, idx)})`
              : `manifest 별칭 경로 일치 (${target})`,
          actualPath: hit,
        };
    }
  }

  // L3 후보 수집 + 내용 증거
  const candidates = collectCandidates(input.expected.path, input.changes, {
    ...input.normalize,
    kind: input.expected.kind,
    glossary: idx,
    root: input.root,
    limit: input.candidateLimit ?? 5,
  });
  if (candidates.length === 0)
    return { ...base, level: 3, verdict: 'missing', confidence: 1, reason: '세션 변경 중 후보 없음' };
  if (!input.acceptance.some((a) => a.type !== 'llm'))
    return {
      ...base,
      level: 3,
      verdict: 'wrong',
      confidence: 0.3,
      reason: '기계 검증 조건이 없어 내용 증거를 확인할 수 없음',
      candidates,
      escalate: true,
    };
  let last: AcceptanceOutcome[] | undefined;
  const rootPosix = toPosixForm(input.root);
  for (const c of candidates) {
    const abs = c.path.startsWith('/') ? c.path : join(rootPosix, c.path);
    const ev = await checkContentEvidence(
      input.acceptance,
      { artifactPath: abs, root: rootPosix, kind: input.expected.kind },
      input.runner ?? defaultAcceptanceRunner,
    );
    last = ev.outcomes;
    if (ev.ok)
      return {
        ...base,
        level: 3,
        verdict: 'relocated',
        confidence: Math.round((0.5 + 0.4 * c.similarity) * 1000) / 1000,
        reason: `acceptance가 후보 경로 ${c.path}에서 통과 — 위치만 다름 (basename 유사도 ${c.similarity})`,
        actualPath: c.path,
        candidates,
        checks: ev.outcomes,
        escalate: true,
      };
  }
  return {
    ...base,
    level: 3,
    verdict: 'wrong',
    confidence: 0.7,
    reason: `후보 ${candidates.length}개 모두 acceptance 실패 — 잘못된 대상`,
    candidates,
    ...(last ? { checks: last } : {}),
  };
}
