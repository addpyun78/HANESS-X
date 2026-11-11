import { describe, expect, it } from 'vitest';
import { buildCard } from '../src/templates.js';
import { PATH_INPUT } from './helpers.js';

describe('H.5 AI 추천 문구 = plain_reason, 쉬운 말 검사 통과 시에만', () => {
  it('통과하면 추천 + 이유 표시', () => {
    const c = buildCard(PATH_INPUT);
    expect(c.recommendation).toBe('accept');
    expect(c.recommendationReason).toBe('안에 든 파일과 테스트 결과가 같아요.');
  });

  it.each([
    ['금지어', 'glossary 별칭과 diff가 같아요.'],
    ['반말', '안에 든 파일이 같다.'],
    ['영어', 'The files inside are identical.'],
    [
      '긴 문장',
      '안에 든 파일과 테스트 결과와 폴더 구조와 이름의 뜻이 모두 거의 같아서 같은 걸로 보는 게 맞아요.',
    ],
  ])('실패(%s)하면 추천 자체를 생략하고 원문은 technical에만', (_n, reason) => {
    const c = buildCard({ ...PATH_INPUT, plainReason: reason });
    expect(c.recommendation).toBeUndefined();
    expect(c.recommendationReason).toBeUndefined();
    expect(c.technical.rawReason).toBe(reason);
  });

  it('plain_reason이 없으면 추천도 없다', () => {
    const { plainReason: _p, ...rest } = PATH_INPUT;
    expect(buildCard(rest).recommendation).toBeUndefined();
  });
});
