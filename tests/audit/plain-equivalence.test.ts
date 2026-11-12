// T-102 F.C5-001.1 동작 동일 테스트: 쉬운 말 판정 구현들이 같은 입력 300개에 같은 답을 내야 한다
// (통합 전: agent-builder designer/plain.ts isPlain · tool-finder reasons.ts isPlain / 통합 뒤: approvals isPlainKorean이 대표)
import { describe, expect, it } from 'vitest';
import { checkPlainKorean } from '../../packages/plugins-core/approvals/src/plain-korean.js';
import { isPlain as builderIsPlain } from '../../packages/plugins-core/agent-builder/src/designer/plain.js';
import { isPlain as finderIsPlain } from '../../packages/plugins-core/tool-finder/src/reasons.js';

let seed = 42;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const pick = <T>(a: readonly T[]) => a[Math.floor(rnd() * a.length)]!;
const WORDS = [
  '파일을 저장해요',
  'API 키를 넣어요',
  '스키마가 틀렸어요',
  '버튼을 눌러 주세요',
  'YAML 형식',
  '설치가 끝났어요',
  'JSON 파싱 오류',
  '토큰이 부족해요',
  '쉬운 말이에요',
  '아주 길고 길어서 한 문장에 마흔다섯 글자를 훨씬 넘어 버리는 아주 긴 문장이에요',
  'hello world',
  '"ai/mobile" 폴더예요',
];
export const PLAIN_INPUTS = Array.from(
  { length: 300 },
  () => `${pick(WORDS)}${pick(['', ' ', '. ', '!'])}${pick(['', pick(WORDS)])}`,
);

describe('쉬운 말 판정 동작 동일 (T-102 C5-001)', () => {
  it('입력 300개: 모든 구현이 기준(checkPlainKorean(s).ok)과 같은 답', () => {
    const base = PLAIN_INPUTS.map((s) => checkPlainKorean(s).ok);
    expect(PLAIN_INPUTS.map((s) => builderIsPlain(s))).toEqual(base);
    expect(PLAIN_INPUTS.map((s) => finderIsPlain(s))).toEqual(base);
    // label(버튼·제목) 모드도 같음
    expect(PLAIN_INPUTS.map((s) => builderIsPlain(s, true))).toEqual(
      PLAIN_INPUTS.map((s) => checkPlainKorean(s, { label: true }).ok),
    );
    expect(new Set(base).size).toBe(2); // 통과·실패가 섞인 입력이라 의미 있는 비교
  });
});
