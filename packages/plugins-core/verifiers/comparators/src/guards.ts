import { glossaryIndex, type Glossary, type GlossaryIndex } from '@harness-x/checklist-ledger';

/**
 * T-100 G.2 진짜 틀림 감지 — 의미 판단 AI에 넘기기 전에 코드로 "다르다"를 확정하는 규칙.
 * 여기서 걸린 차이는 different(next: fail)로 끝나므로, AI가 잘못 "같다"고 답해도(오판) 통과하지 않는다.
 *   - 상태 반대: 한쪽은 성공(success·ok·완료…), 다른 쪽은 실패(error·failed·오류…)
 *   - 숫자만 다름: 숫자를 뺀 나머지 글은 같고 숫자 값이 다름 ("HTTP 200" vs "HTTP 500")
 *   - 다른 폴더: 같은 깊이의 경로 조각이 서로 다른 glossary 단어 (harness/server vs harness/client)
 */

const SUCCESS_WORDS = [
  'success',
  'succeeded',
  'successful',
  'successfully',
  'ok',
  'okay',
  'pass',
  'passed',
  'passing',
  'done',
  'completed',
  'complete',
  '완료',
  '성공',
  '통과',
  '정상',
];
const FAILURE_WORDS = [
  'error',
  'errors',
  'err',
  'fail',
  'failed',
  'failing',
  'failure',
  'fatal',
  'exception',
  'crash',
  'crashed',
  '실패',
  '오류',
  '에러',
  '중단',
];

const isHangul = (w: string) => /^\p{Script=Hangul}+$/u.test(w);

function matches(token: string, words: readonly string[]): boolean {
  return words.some((w) => token === w || (isHangul(w) && token.startsWith(w)));
}

export type StatusPolarity = 'success' | 'failure' | 'mixed' | 'none';

/** 글의 성공/실패 성격 ("3 passed, 0 failed"처럼 둘 다 있으면 mixed) */
export function statusPolarity(text: string): StatusPolarity {
  const tokens =
    text
      .normalize('NFC')
      .toLowerCase()
      .match(/[\p{L}]+/gu) ?? [];
  const s = tokens.some((t) => matches(t, SUCCESS_WORDS));
  const f = tokens.some((t) => matches(t, FAILURE_WORDS));
  return s && f ? 'mixed' : s ? 'success' : f ? 'failure' : 'none';
}

/** 한쪽은 성공, 다른 쪽은 실패면 사유 */
export function statusConflict(expected: string, actual: string): string | undefined {
  const a = statusPolarity(expected);
  const b = statusPolarity(actual);
  if ((a === 'success' && b === 'failure') || (a === 'failure' && b === 'success'))
    return `상태가 반대 (기대 ${a === 'success' ? '성공' : '실패'}, 실제 ${b === 'success' ? '성공' : '실패'})`;
  return undefined;
}

const NUM_RE = /\d+(?:[.,_]\d+)*/g;
const numValue = (s: string) => s.replace(/[,_]/g, '');

/** 숫자를 뺀 글은 같고 숫자 값만 다르면 사유 ("HTTP 200" vs "HTTP 500") */
export function numberConflict(expected: string, actual: string): string | undefined {
  const ea = expected.match(NUM_RE) ?? [];
  const eb = actual.match(NUM_RE) ?? [];
  if (ea.length === 0 || ea.length !== eb.length) return undefined;
  if (expected.replace(NUM_RE, '#') !== actual.replace(NUM_RE, '#')) return undefined;
  const diff = ea.findIndex((n, k) => Number(numValue(n)) !== Number(numValue(eb[k]!)));
  return diff >= 0 ? `숫자만 다름 (${ea[diff]} → ${eb[diff]})` : undefined;
}

/**
 * 별칭 키(aliasKeyOf 결과) 두 개가 같은 깊이에서 서로 다른 glossary 단어를 가지면 사유
 * ("harness/server" vs "harness/client" → 서버와 클라이언트는 다른 폴더)
 */
export function folderConflict(
  aliasKeyA: string,
  aliasKeyB: string,
  glossary: Glossary | GlossaryIndex,
): string | undefined {
  const as = aliasKeyA.split('/');
  const bs = aliasKeyB.split('/');
  if (as.length !== bs.length) return undefined;
  const known = new Set(glossaryIndex(glossary).glossary.terms.map((t) => t.canonical.toLowerCase()));
  for (let k = 0; k < as.length; k++) {
    const x = as[k]!.toLowerCase();
    const y = bs[k]!.toLowerCase();
    if (x !== y && known.has(x) && known.has(y)) return `다른 폴더 (${as[k]} ≠ ${bs[k]}, ${k + 1}번째 조각)`;
  }
  return undefined;
}
