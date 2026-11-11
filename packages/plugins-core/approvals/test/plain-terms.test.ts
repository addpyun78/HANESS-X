import { describe, expect, it } from 'vitest';
import { checkPlainKorean, plainTermReplace } from '../src/plain-korean.js';

describe('H.7 꼭 필요한 용어 치환 사전', () => {
  it.each([
    ['커밋을 만들었어요.', '저장 기록을 만들었어요.'],
    ['브랜치를 바꿨어요.', '작업 갈래를 바꿨어요.'],
    ['commit 3개와 branch 하나가 있어요.', '저장 기록 3개와 작업 갈래 하나가 있어요.'],
    ['디렉터리 이름이 달라요.', '폴더 이름이 달라요.'],
    ['diff를 보면 정규화 뒤에도 달라요.', '차이를 보면 자동 정리 뒤에도 달라요.'],
    ['신뢰도가 임계값보다 낮아요.', '확신 정도가 기준보다 낮아요.'],
    ['리포지토리를 머지했어요.', '저장소를 합치기했어요.'],
  ])('%s → %s', (from, to) => {
    expect(plainTermReplace(from)).toBe(to);
  });

  it('치환 뒤에는 금지어 검사를 통과', () => {
    expect(checkPlainKorean('커밋을 만들었어요.').ok).toBe(false);
    expect(checkPlainKorean(plainTermReplace('커밋을 만들었어요.')).ok).toBe(true);
  });
});
