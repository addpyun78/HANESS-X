/** 인벤토리용 간단한 토큰화 (태그 추출·BM25 공용, 외부 호출 없음) */

const STOPWORDS = new Set([
  // 영어
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'in',
  'into',
  'is',
  'it',
  'of',
  'on',
  'or',
  'the',
  'this',
  'to',
  'use',
  'used',
  'when',
  'with',
  // 한국어 (조사·흔한 말)
  '것',
  '수',
  '등',
  '및',
  '때',
  '위한',
  '하는',
  '한다',
  '합니다',
  '있는',
  '없는',
  '해',
  '줘',
  '주는',
  '만들어',
]);

/** 흔한 한국어 조사·어미를 떼어 낸다 (간이 형태소 처리) */
const KO_SUFFIX =
  /(으로|에서|에게|까지|부터|처럼|이랑|하고|이나|이다|입니다|해요|하는|하기|을|를|이|가|은|는|의|에|와|과|도|로|만)$/;

export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const raw of text
    .toLowerCase()
    .normalize('NFC')
    .split(/[^\p{L}\p{N}]+/u)) {
    if (!raw) continue;
    let t = raw;
    if (/\p{Script=Hangul}/u.test(t) && t.length > 2) t = t.replace(KO_SUFFIX, '');
    if (t.length < 2 && !/\p{Script=Hangul}/u.test(t)) continue;
    if (STOPWORDS.has(t)) continue;
    out.push(t);
  }
  return out;
}

/** 설명에서 키워드 태그 (등장 순, 중복 제거, 최대 n개) */
export function extractTags(text: string, n = 6): string[] {
  const seen = new Set<string>();
  for (const t of tokenize(text)) {
    if (/^\d+$/.test(t) || t === 'redacted') continue;
    seen.add(t);
    if (seen.size >= n) break;
  }
  return [...seen];
}
