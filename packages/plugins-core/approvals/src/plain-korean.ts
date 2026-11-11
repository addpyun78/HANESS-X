/**
 * 쉬운 말 검사기 (T-100 H.6) · 용어 치환 사전 (H.7)
 * 사용자에게 보이는 설명·질문·추천은 이 검사를 통과해야 화면에 나간다.
 *   1) 금지어(개발 용어) 0개
 *   2) 문장당 45자 이하
 *   3) 존댓말 문장 끝(…요 / …니다 / …니까)
 *   4) 영어 비율 30% 이하 (파일·폴더 이름 제외)
 * 큰따옴표 안의 값("ai/mobile", "로그인 성공")은 사용자가 만든 값이므로 1)·2)·4) 계산에서 뺀다.
 */

export type PlainRule = 'banned-word' | 'sentence-length' | 'honorific' | 'english-ratio';

export interface PlainViolation {
  rule: PlainRule;
  detail: string;
}

export interface PlainCheckResult {
  ok: boolean;
  violations: PlainViolation[];
}

export interface PlainCheckOptions {
  /** 버튼·제목처럼 문장이 아닌 짧은 글이면 true (존댓말 검사 생략) */
  label?: boolean;
  /** 문장당 최대 글자 수 (기본 45) */
  maxSentence?: number;
  /** 영어 비율 상한 (기본 0.3) */
  maxEnglishRatio?: number;
}

export const MAX_SENTENCE_CHARS = 45;
export const MAX_ENGLISH_RATIO = 0.3;

/** 금지어 (개발 용어). 영어는 단어 경계, 한국어는 포함 여부로 찾는다 */
export const BANNED_WORDS: readonly string[] = [
  // 영어
  'diff',
  'regex',
  'regexp',
  'schema',
  'glossary',
  'manifest',
  'JSON',
  'YAML',
  'hash',
  'NFC',
  'commit',
  'branch',
  'merge',
  'rebase',
  'repo',
  'repository',
  'token',
  'endpoint',
  'API',
  'runtime',
  'compile',
  'build',
  'lint',
  'dependency',
  'cache',
  'comparator',
  'threshold',
  'confidence',
  'alias',
  'ledger',
  'verdict',
  'payload',
  'CRLF',
  'stack trace',
  'prompt',
  'session',
  'parse',
  'normalize',
  // 한국어로 옮겨 적은 개발 용어
  '정규식',
  '정규화',
  '스키마',
  '글로서리',
  '매니페스트',
  '해시',
  '커밋',
  '브랜치',
  '머지',
  '리베이스',
  '레포',
  '리포지토리',
  '디렉터리',
  '디렉토리',
  '토큰',
  '엔드포인트',
  '런타임',
  '컴파일',
  '빌드',
  '린트',
  '린터',
  '의존성',
  '캐시',
  '비교기',
  '임계값',
  '신뢰도',
  '별칭',
  '원장',
  '페이로드',
  '파싱',
  '파서',
  '프롬프트',
  '세션',
  '인코딩',
  '체크섬',
  '리팩터링',
];

/** 꼭 필요한 용어는 쉬운 말로 바꾼다 (H.7). 긴 말부터 바꾼다 */
export const PLAIN_TERMS: Readonly<Record<string, string>> = Object.freeze({
  커밋: '저장 기록',
  commit: '저장 기록',
  브랜치: '작업 갈래',
  branch: '작업 갈래',
  머지: '합치기',
  merge: '합치기',
  리포지토리: '저장소',
  레포: '저장소',
  repository: '저장소',
  repo: '저장소',
  디렉터리: '폴더',
  디렉토리: '폴더',
  directory: '폴더',
  정규화: '자동 정리',
  정규식: '글자 규칙',
  regex: '글자 규칙',
  비교기: '비교 방법',
  comparator: '비교 방법',
  신뢰도: '확신 정도',
  confidence: '확신 정도',
  임계값: '기준',
  threshold: '기준',
  캐시: '임시 보관',
  cache: '임시 보관',
  빌드: '만들기',
  build: '만들기',
  의존성: '먼저 필요한 것',
  diff: '차이',
  해시: '지문',
  hash: '지문',
  스키마: '형식 규칙',
  schema: '형식 규칙',
  glossary: '이름 사전',
  글로서리: '이름 사전',
  manifest: '파일 위치 목록',
  매니페스트: '파일 위치 목록',
  JSON: '설정 파일',
  별칭: '다른 이름',
  alias: '다른 이름',
  토큰: '열쇠',
  token: '열쇠',
  세션: '작업',
  session: '작업',
  원장: '체크리스트',
  프롬프트: '지시문',
  prompt: '지시문',
});

const isAscii = (w: string) => /^[\x20-\x7e]+$/.test(w);
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function wordRe(w: string, flags: string): RegExp {
  // 영어는 영문자 경계(한국어 조사가 붙어도 찾는다: "diff를"),
  // 한국어는 낱말 첫머리에서만 ("나머지"의 "머지"는 아님, "커밋을"은 찾음)
  return isAscii(w)
    ? new RegExp(`(?<![A-Za-z])${escapeRe(w)}(?![A-Za-z])`, flags)
    : new RegExp(`(?<!\\p{Script=Hangul})${escapeRe(w)}`, flags + 'u');
}

/** H.7 용어 치환 */
export function plainTermReplace(text: string): string {
  const keys = Object.keys(PLAIN_TERMS).sort((a, b) => b.length - a.length);
  let out = text;
  for (const k of keys) out = out.replace(wordRe(k, 'gi'), PLAIN_TERMS[k]!);
  return out;
}

const QUOTED_RE = /"[^"\n]*"|“[^”\n]*”/g;
/** 따옴표 밖의 파일·폴더 이름 (a/b, src\x, index.ts) */
const PATHLIKE_RE =
  /[A-Za-z0-9_.~-]*[/\\][A-Za-z0-9_./\\~-]*|[A-Za-z0-9_-]+\.[A-Za-z][A-Za-z0-9]{0,5}(?![A-Za-z0-9])/g;

/** 사용자 값·파일 이름을 뺀 "우리가 쓴 말" */
function ownWords(text: string): string {
  return text.replace(QUOTED_RE, ' ').replace(PATHLIKE_RE, ' ');
}

export function splitSentences(text: string): string[] {
  // 따옴표 안의 마침표에서 자르지 않도록 값을 잠시 가린다
  const vals: string[] = [];
  const masked = text.replace(QUOTED_RE, (m) => `\uE000${vals.push(m) - 1}\uE000`);
  return masked
    .split(/(?<=[.!?。])\s+|\n+/)
    .map((s) => s.replace(/\uE000(\d+)\uE000/g, (_m, i: string) => vals[Number(i)]!).trim())
    .filter((s) => s.length > 0);
}

const HONORIFIC_END = /(요|니다|니까|세요|십시오)$/;

function endsHonorific(sentence: string): boolean {
  const core = sentence.replace(/[\s.!?…~)"'”’」』\]]+$/u, '');
  return HONORIFIC_END.test(core);
}

/** 괄호로만 된 덧붙임 "(확신 정도: 중간)"은 문장으로 보지 않는다 */
const isAside = (s: string) => /^\(.*\)$/.test(s);

export function checkPlainKorean(text: string, opts: PlainCheckOptions = {}): PlainCheckResult {
  const maxLen = opts.maxSentence ?? MAX_SENTENCE_CHARS;
  const maxEn = opts.maxEnglishRatio ?? MAX_ENGLISH_RATIO;
  const violations: PlainViolation[] = [];
  const own = ownWords(text);

  // 1) 금지어
  const found = new Set<string>();
  for (const w of BANNED_WORDS) {
    if (wordRe(w, 'i').test(own)) found.add(w);
  }
  for (const w of found) violations.push({ rule: 'banned-word', detail: `어려운 말 "${w}"` });

  // 2)·3) 문장마다
  for (const s of splitSentences(text)) {
    const len = [...s.replace(QUOTED_RE, '""')].length;
    if (len > maxLen) violations.push({ rule: 'sentence-length', detail: `${len}자 문장: ${s}` });
    if (!opts.label && !isAside(s) && !endsHonorific(s))
      violations.push({ rule: 'honorific', detail: `존댓말이 아닌 문장: ${s}` });
  }

  // 4) 영어 비율
  const latin = (own.match(/[A-Za-z]/g) ?? []).length;
  const hangul = (own.match(/\p{Script=Hangul}/gu) ?? []).length;
  if (latin + hangul > 0) {
    const ratio = latin / (latin + hangul);
    if (ratio > maxEn)
      violations.push({ rule: 'english-ratio', detail: `영어 비율 ${Math.round(ratio * 100)}%` });
  }
  return { ok: violations.length === 0, violations };
}

/** 여러 글을 한 번에 검사 (모두 통과해야 ok) */
export function checkPlainAll(texts: readonly string[], opts: PlainCheckOptions = {}): PlainCheckResult {
  const violations = texts.flatMap((t) => checkPlainKorean(t, opts).violations);
  return { ok: violations.length === 0, violations };
}
