/**
 * 원자성 린터 (T-021)
 * 체크리스트 제안(propose) 단계에서 항목이 "동사 1개 · 산출물 1개 · 기계 검증 가능 · 작은 크기 · 순환 없음"인지 검사한다.
 * 입력은 아직 검증 전인 초안이므로 느슨한 타입(LintItem)을 받는다 — artifactId에 배열이 오는 경우 등도 진단한다.
 */

export const LINT_RULES = {
  R1: '단일 동사',
  R2: '산출물 1개',
  R3: '기계 검증 가능',
  R4: '크기 상한',
  R5: 'deps 순환 금지',
} as const;
export type LintRuleId = keyof typeof LINT_RULES;

export interface LintItem {
  id: string;
  title: string;
  artifactId?: string | string[] | null;
  acceptance?: readonly { type: string }[];
  deps?: readonly string[];
  estimate?: { files?: number; diffLines?: number };
}

export interface LintViolation {
  rule: LintRuleId;
  itemId: string;
  message: string;
  /** 규칙별 근거 (R1: 감지한 동사·접속어, R5: 순환 경로 등) */
  detail?: Record<string, unknown>;
}

export interface LintOptions {
  /** R4: 예상 변경 파일 상한 (기본 1) */
  maxFiles?: number;
  /** R4: 예상 diff 줄 상한 (기본 150) */
  maxDiffLines?: number;
  /** R1: 추가 동사 (한글 어간 또는 영어 원형) */
  extraVerbs?: readonly string[];
}

export interface LintResult {
  ok: boolean;
  violations: LintViolation[];
}

// ── R1 동사 사전 ───────────────────────────────────────────────
/** 한글 동사 어간 ("-하다"형은 명사 어근으로 적는다: 작성 → 작성하고/작성한 뒤/작성 감지) */
export const KO_VERB_NOUNS = [
  '작성',
  '추가',
  '구현',
  '수정',
  '삭제',
  '제거',
  '생성',
  '정의',
  '테스트',
  '검증',
  '연결',
  '배포',
  '설치',
  '설정',
  '변경',
  '리팩터링',
  '리팩토링',
  '문서화',
  '개선',
  '적용',
  '등록',
  '이동',
  '분리',
  '통합',
  '갱신',
  '업데이트',
  '빌드',
  '확인',
  '저장',
  '정리',
] as const;
/** 고유어 동사 어간 (만들다 → 만들) */
export const KO_VERB_STEMS = [
  '만들',
  '고치',
  '지우',
  '넣',
  '빼',
  '바꾸',
  '바꿔',
  '옮기',
  '붙이',
  '짜',
  '쓰',
  '띄우',
  '돌리',
  '나누',
  '합치',
] as const;
export const EN_VERBS = [
  'add',
  'create',
  'implement',
  'write',
  'test',
  'fix',
  'remove',
  'delete',
  'update',
  'refactor',
  'build',
  'define',
  'deploy',
  'install',
  'configure',
  'rename',
  'move',
  'document',
  'migrate',
  'integrate',
  'verify',
  'make',
  'set',
  'connect',
] as const;

/** 한 항목 안에 동작 두 개를 잇는 접속어 */
const CONJUNCTIONS: { re: RegExp; label: string }[] = [
  { re: /하고(?=[\s,.]|$)/u, label: '하고' },
  { re: /(?:^|\s)및(?=\s|$)/u, label: '및' },
  { re: /(?:^|\s)그리고(?=\s|$)/u, label: '그리고' },
  { re: /(?:한|된)\s*(?:뒤|후|다음)(?:에)?(?=\s|$)/u, label: '한 뒤/후' },
  { re: /\band\b/i, label: 'and' },
  { re: /\bthen\b/i, label: 'then' },
  { re: /\s&\s/u, label: '&' },
];

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 제목에서 동사(동작어) 목록을 찾는다 */
export function findVerbs(title: string, extraVerbs: readonly string[] = []): string[] {
  const t = title.normalize('NFC');
  const found: string[] = [];
  for (const v of [...KO_VERB_NOUNS, ...extraVerbs.filter((v) => /[가-힣]/.test(v))]) {
    if (new RegExp(`${escapeRe(v)}(?:하|해|한|할|함|$|[\\s,./)])`, 'u').test(t)) found.push(v);
  }
  for (const s of KO_VERB_STEMS) {
    // 어간 + 활용 어미 (만들고, 만들기, 만든다는 제외) — 단어 앞쪽에서만
    if (new RegExp(`(?:^|\\s)${escapeRe(s)}(?:고|기|어|어서|자|었|은)(?=[\\s,.]|$)`, 'u').test(t))
      found.push(s);
  }
  for (const v of [...EN_VERBS, ...extraVerbs.filter((v) => /^[a-z]+$/i.test(v))]) {
    if (new RegExp(`\\b${escapeRe(v)}(?:s|es|ed|ing)?\\b`, 'i').test(t)) found.push(v.toLowerCase());
  }
  return [...new Set(found)];
}

/** "-고"로 이어지는 연결 어미 (만들고, 작성하고, 고치고) */
function connectiveVerbs(title: string, extraVerbs: readonly string[]): string[] {
  const t = title.normalize('NFC');
  const out: string[] = [];
  for (const s of [...KO_VERB_STEMS, ...extraVerbs.filter((v) => /[가-힣]/.test(v))])
    if (new RegExp(`${escapeRe(s)}고(?=[\\s,.]|$)`, 'u').test(t)) out.push(`${s}고`);
  return out;
}

function lintR1(item: LintItem, opts: LintOptions): LintViolation | null {
  const extra = opts.extraVerbs ?? [];
  const verbs = findVerbs(item.title, extra);
  const conj = CONJUNCTIONS.filter((c) => c.re.test(item.title.normalize('NFC'))).map((c) => c.label);
  conj.push(...connectiveVerbs(item.title, extra));
  // 쉼표·세미콜론·슬래시로 나뉜 절마다 동사가 있으면 동작이 여러 개
  const clauses = item.title
    .split(/[,;，、]|\s\/\s/u)
    .map((c) => c.trim())
    .filter(Boolean);
  const verbClauses = clauses.filter((c) => findVerbs(c, extra).length > 0);
  if (conj.length === 0 && verbClauses.length < 2) return null;
  return {
    rule: 'R1',
    itemId: item.id,
    message: `동작이 둘 이상입니다 (${[...conj, ...(verbClauses.length >= 2 ? ['절 여러 개'] : [])].join(', ')}). 동사 하나당 항목 하나로 나누세요.`,
    detail: { verbs, conjunctions: conj },
  };
}

function lintR2(item: LintItem): LintViolation | null {
  const a = item.artifactId;
  const list = a === undefined || a === null ? [] : Array.isArray(a) ? a : a.split(/[,\s]+/).filter(Boolean);
  if (list.length === 1) return null;
  return {
    rule: 'R2',
    itemId: item.id,
    message:
      list.length === 0
        ? '산출물(artifactId)이 없습니다. 항목은 산출물 정확히 1개를 가리켜야 합니다.'
        : `산출물이 ${list.length}개입니다 (${list.join(', ')}). 산출물마다 항목을 나누세요.`,
    detail: { artifactIds: list },
  };
}

function lintR3(item: LintItem): LintViolation | null {
  const acc = item.acceptance ?? [];
  const machine = acc.filter((a) => a.type !== 'llm');
  if (machine.length > 0) return null;
  return {
    rule: 'R3',
    itemId: item.id,
    message:
      acc.length === 0
        ? '검증 조건(acceptance)이 없습니다. 명령·테스트·심볼·파일·스키마 중 하나 이상을 지정하세요.'
        : 'acceptance가 llm 판단뿐입니다. 기계로 검증할 수 있는 조건(테스트·명령·심볼 등)을 추가하세요.',
    detail: { types: acc.map((a) => a.type) },
  };
}

function lintR4(item: LintItem, opts: LintOptions): LintViolation | null {
  const maxFiles = opts.maxFiles ?? 1;
  const maxLines = opts.maxDiffLines ?? 150;
  const e = item.estimate;
  if (!e || (e.files === undefined && e.diffLines === undefined)) return null;
  const filesOk = e.files === undefined ? undefined : e.files <= maxFiles;
  const linesOk = e.diffLines === undefined ? undefined : e.diffLines <= maxLines;
  // 상한: 변경 파일 maxFiles개 이하 "또는" diff maxLines줄 이하
  if (filesOk === true || linesOk === true) return null;
  return {
    rule: 'R4',
    itemId: item.id,
    message: `예상 크기가 상한을 넘습니다 (파일 ${e.files ?? '?'}개, diff ${e.diffLines ?? '?'}줄; 상한: 파일 ${maxFiles}개 또는 diff ${maxLines}줄). 더 작게 나누세요.`,
    detail: { files: e.files, diffLines: e.diffLines, maxFiles, maxDiffLines: maxLines },
  };
}

/** deps 그래프의 순환을 모두 찾는다 (각 순환은 시작 id로 끝나는 경로) */
export function findCycles(items: readonly Pick<LintItem, 'id' | 'deps'>[]): string[][] {
  const graph = new Map(items.map((i) => [i.id, i.deps ?? []]));
  const state = new Map<string, 1 | 2>(); // 1: 방문 중, 2: 완료
  const stack: string[] = [];
  const cycles: string[][] = [];
  const seen = new Set<string>();
  const visit = (id: string): void => {
    state.set(id, 1);
    stack.push(id);
    for (const d of graph.get(id) ?? []) {
      if (!graph.has(d)) continue;
      const s = state.get(d);
      if (s === 1) {
        const cyc = [...stack.slice(stack.indexOf(d)), d];
        const key = [...cyc.slice(0, -1)].sort().join('|');
        if (!seen.has(key)) {
          seen.add(key);
          cycles.push(cyc);
        }
      } else if (s === undefined) visit(d);
    }
    stack.pop();
    state.set(id, 2);
  };
  for (const i of items) if (!state.has(i.id)) visit(i.id);
  return cycles;
}

/** 항목 1개 검사 (R1~R4) */
export function lintItem(item: LintItem, opts: LintOptions = {}): LintViolation[] {
  return [lintR1(item, opts), lintR2(item), lintR3(item), lintR4(item, opts)].filter(
    (v): v is LintViolation => v !== null,
  );
}

/** 체크리스트 전체 검사 (R1~R5) */
export function lintChecklist(items: readonly LintItem[], opts: LintOptions = {}): LintResult {
  const violations = items.flatMap((i) => lintItem(i, opts));
  for (const cyc of findCycles(items))
    violations.push({
      rule: 'R5',
      itemId: cyc[0]!,
      message: `deps 순환: ${cyc.join(' → ')}. 의존 방향을 한쪽으로 정리하세요.`,
      detail: { cycle: cyc },
    });
  return { ok: violations.length === 0, violations };
}

/** 21.6 위반 시 엔진에게 돌려줄 재분해 요청 메시지 (위반 규칙·항목 id 포함) */
export function redecomposeMessage(violations: readonly LintViolation[]): string {
  if (violations.length === 0) return '';
  const ids = [...new Set(violations.map((v) => v.itemId))];
  const lines = [
    `체크리스트 재분해 요청: 원자성 규칙 위반 ${violations.length}건 (항목 ${ids.join(', ')})`,
    ...violations.map((v) => `- [${v.rule} ${LINT_RULES[v.rule]}] 항목 ${v.itemId}: ${v.message}`),
    '위반 항목을 규칙에 맞게 다시 쪼갠 뒤 체크리스트 전체를 다시 제안하세요. 규칙: 동사 1개 · 산출물 1개 · 기계 검증 가능 · 파일 1개 또는 diff 150줄 이하 · deps 순환 없음.',
  ];
  return lines.join('\n');
}
