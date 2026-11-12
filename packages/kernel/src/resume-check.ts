import type { ResumableSession } from './resume.js';

/**
 * T-101 2B.3 재개 전 점검기 (6가지)
 * 이어하기 전에 자동으로 점검하고, 문제가 있을 때만 쉬운 말로 묻는다.
 *
 * | 점검 | 문제일 때 |
 * | 멈춘 뒤 파일이 바뀌었나 | 바뀐 목록 + [바뀐 걸 반영해서 계속(추천)] [멈춘 때로 되돌리고 계속] [계획부터 다시] |
 * | 그때 쓰던 AI를 지금 쓸 수 있나 | 다른 AI·폴백으로 바꿀지 |
 * | 에이전트·설정이 그 뒤 바뀌었나 | [시작할 때 버전으로 계속(기본)] [새 버전으로] |
 * | 대답 안 한 승인 카드가 있나 | 카드 먼저 보여줌 |
 * | 오래됐나(7일 이상) | 지금까지 한 일 요약 보여주고 확인 |
 * | 다른 실행 중 세션이 같은 파일을 쓰나 | 그 세션이 끝날 때까지 기다릴지 |
 *
 * 점검마다 필요한 사실은 주입 함수(ResumeCheckDeps)로 받는다 — 실제 구현은 2B.4~2B.8.
 */

export const RESUME_CHECK_IDS = ['files', 'engine', 'version', 'approvals', 'stale', 'conflict'] as const;
export type ResumeCheckId = (typeof RESUME_CHECK_IDS)[number];

export interface ResumeChoice {
  id: string;
  label: string;
  /** 추천(카드에 "추천" 표시) */
  recommended?: boolean;
  /** 고르지 않으면 이것 */
  default?: boolean;
}

export interface ResumeIssue {
  check: ResumeCheckId;
  title: string;
  body: string;
  choices: ResumeChoice[];
  /** 카드 아래 목록 (바뀐 파일, 끝낸 일 등) */
  list?: string[];
  /** true면 답하기 전에는 이어할 수 없다 (승인 카드) */
  blocking?: boolean;
}

export interface FileChangeLike {
  path: string;
  change: 'added' | 'modified' | 'deleted';
}

export interface ConflictLike {
  sessionId: string;
  title: string;
  paths: string[];
}

export interface ResumeCheckDeps {
  now?: Date;
  /** 멈춘 뒤 바뀐 파일 (2B.4) */
  fileChanges?: () => FileChangeLike[];
  /** Git 작업 폴더인가 (멈춘 때로 되돌리기는 Git일 때만) */
  isGit?: () => boolean;
  /** 엔진을 지금 쓸 수 있나 (2B.5) */
  engineAvailable?: (engineId: string) => boolean;
  /** 원래 엔진을 못 쓸 때 제안할 엔진들 (앞이 우선) */
  engineSuggestions?: (engineId: string) => string[];
  /** 시작 뒤 바뀐 에이전트·설정 파일 (2B.6) */
  changedSinceStart?: () => string[];
  /** 대답 안 한 승인 카드 */
  pendingApprovals?: () => { id: string; title: string }[];
  /** 지금까지 끝낸 항목 (2B.7) */
  doneItems?: () => { id: string; title: string }[];
  /** 같은 프로젝트에서 같은 산출물을 쓰는 실행 중 세션 (2B.8) */
  conflicts?: () => ConflictLike[];
}

export const STALE_DAYS = 7;
const DAY_MS = 86_400_000;

export interface ResumeCheckResult {
  sessionId: string;
  /** 문제가 하나도 없으면 바로 이어한다 */
  ok: boolean;
  issues: ResumeIssue[];
  /** 점검한 항목 (주입 함수가 없으면 건너뜀) */
  checked: ResumeCheckId[];
}

const CHANGE_WORD: Record<FileChangeLike['change'], string> = {
  added: '새로 생김',
  modified: '고쳐짐',
  deleted: '지워짐',
};

export function fileIssue(changes: FileChangeLike[], isGit: boolean): ResumeIssue {
  return {
    check: 'files',
    title: '멈춘 뒤에 파일이 바뀌었어요',
    body: `멈춘 뒤에 파일 ${changes.length}개가 바뀌었어요. 어떻게 이어할까요?`,
    list: changes.map((c) => `${c.path} (${CHANGE_WORD[c.change]})`),
    choices: [
      { id: 'keep', label: '바뀐 걸 반영해서 계속', recommended: true, default: true },
      ...(isGit ? [{ id: 'revert', label: '멈춘 때로 되돌리고 계속' }] : []),
      { id: 'replan', label: '계획부터 다시' },
    ],
  };
}

/** 카드에 보이는 엔진 이름 (영문 id 대신 쉬운 말) */
export const ENGINE_PLAIN_NAME: Record<string, string> = {
  'claude-code': '클로드 코드',
  codex: '코덱스',
  antigravity: '안티그래비티',
  gemini: '제미나이',
  'openai-compat': '내 컴퓨터 AI',
};

export function enginePlainName(id: string): string {
  return ENGINE_PLAIN_NAME[id] ?? ENGINE_PLAIN_NAME[id.split(':')[0]!] ?? id;
}

export function engineIssue(engineId: string, suggestions: string[]): ResumeIssue {
  return {
    check: 'engine',
    title: '그때 쓰던 AI를 지금 쓸 수 없어요',
    body: `그때 쓰던 ${enginePlainName(engineId)}를 지금 쓸 수 없어요. 다른 AI로 바꿔서 이어할까요?`,
    choices: [
      ...suggestions.map((id, i) => ({
        id: `engine:${id}`,
        label: `${enginePlainName(id)}로 바꾸기`,
        ...(i === 0 ? { recommended: true, default: true } : {}),
      })),
      { id: 'wait', label: '나중에 하기' },
    ],
  };
}

export function versionIssue(files: string[]): ResumeIssue {
  return {
    check: 'version',
    title: '에이전트나 설정이 그 뒤에 바뀌었어요',
    body: '시작한 뒤에 에이전트나 설정이 바뀌었어요. 어느 쪽으로 이어할까요?',
    list: files,
    choices: [
      { id: 'pinned', label: '시작할 때 버전으로 계속', default: true },
      { id: 'latest', label: '새 버전으로' },
    ],
  };
}

export function approvalsIssue(cards: { id: string; title: string }[]): ResumeIssue {
  return {
    check: 'approvals',
    title: '대답하지 않은 확인 카드가 있어요',
    body: `확인 카드 ${cards.length}개에 먼저 대답해 주세요. 대답하면 이어서 해요.`,
    list: cards.map((c) => c.title),
    choices: [{ id: 'show-approvals', label: '카드 보기', default: true }],
    blocking: true,
  };
}

/** 2B.7 지금까지 한 일 요약 (끝낸 항목 기준, 쉬운 말) */
export function staleIssue(days: number, done: { id: string; title: string }[]): ResumeIssue {
  return {
    check: 'stale',
    title: '멈춘 지 오래됐어요',
    body:
      done.length > 0
        ? `멈춘 지 ${days}일이 지났어요. 지금까지 ${done.length}개를 끝냈어요. 이대로 이어할까요?`
        : `멈춘 지 ${days}일이 지났어요. 아직 끝낸 일은 없어요. 이대로 이어할까요?`,
    list: done.map((d) => `끝냄: ${d.title}`),
    choices: [
      { id: 'continue', label: '이어서 하기', default: true },
      { id: 'replan', label: '계획부터 다시' },
    ],
  };
}

export function conflictIssue(conflicts: ConflictLike[]): ResumeIssue {
  const paths = [...new Set(conflicts.flatMap((c) => c.paths))].sort();
  return {
    check: 'conflict',
    title: '다른 작업이 같은 파일을 쓰고 있어요',
    body: `지금 실행 중인 다른 작업(${conflicts.map((c) => c.title).join(', ')})이 같은 파일을 쓰고 있어요. 그 작업이 끝날 때까지 기다릴까요?`,
    list: paths,
    choices: [
      { id: 'wait', label: '끝날 때까지 기다리기', recommended: true, default: true },
      { id: 'now', label: '지금 이어하기' },
    ],
  };
}

/** 6가지 점검 (주입 함수가 있는 것만). 표 순서대로 문제 카드를 돌려준다 */
export function checkBeforeResume(s: ResumableSession, deps: ResumeCheckDeps): ResumeCheckResult {
  const issues: ResumeIssue[] = [];
  const checked: ResumeCheckId[] = [];
  if (deps.fileChanges) {
    checked.push('files');
    const ch = deps.fileChanges();
    if (ch.length) issues.push(fileIssue(ch, deps.isGit?.() ?? false));
  }
  if (deps.engineAvailable && s.engineId) {
    checked.push('engine');
    if (!deps.engineAvailable(s.engineId))
      issues.push(engineIssue(s.engineId, deps.engineSuggestions?.(s.engineId) ?? []));
  }
  if (deps.changedSinceStart) {
    checked.push('version');
    const files = deps.changedSinceStart();
    if (files.length) issues.push(versionIssue(files));
  }
  if (deps.pendingApprovals) {
    checked.push('approvals');
    const cards = deps.pendingApprovals();
    if (cards.length) issues.push(approvalsIssue(cards));
  }
  {
    checked.push('stale');
    const now = deps.now ?? new Date();
    const days = Math.floor((now.getTime() - Date.parse(s.paused.at)) / DAY_MS);
    if (days >= STALE_DAYS) issues.push(staleIssue(days, deps.doneItems?.() ?? []));
  }
  if (deps.conflicts) {
    checked.push('conflict');
    const c = deps.conflicts();
    if (c.length) issues.push(conflictIssue(c));
  }
  return { sessionId: s.sessionId, ok: issues.length === 0, issues, checked };
}

/** 답하지 않은 카드는 기본 선택지로 (blocking 카드는 기본값으로 넘어갈 수 없다) */
export function defaultChoices(issues: ResumeIssue[]): Partial<Record<ResumeCheckId, string>> {
  const out: Partial<Record<ResumeCheckId, string>> = {};
  for (const i of issues) {
    if (i.blocking) continue;
    const d = i.choices.find((c) => c.default) ?? i.choices[0];
    if (d) out[i.check] = d.id;
  }
  return out;
}
