import { describe, expect, it } from 'vitest';
import { groupByStage, renderAutoSummary } from '../src/index.js';
import { pictureTree } from './stages-sample.js';

const review = [
  { stageId: 'build', text: '버튼 색을 AI가 정했어요. 확인해 주세요.' },
  { stageId: 'plan', text: '화면 하나를 뺐어요.' },
  { text: '시간 상한에 가까웠어요.' },
  { stageId: 'build', text: '새 그림 파일을 하나 넣었어요.' },
];

describe('4F.7 오토 모드 "돌아오면 확인할 것"·종료 요약을 단계별로 묶기 (모드는 인자)', () => {
  it('단계 순서로 묶고, 단계가 없는 줄은 "공통"', () => {
    expect(groupByStage(pictureTree(), review).map((g) => [g.title, g.entries.length])).toEqual([
      ['plan 단계', 1],
      ['build 단계', 2],
      ['공통', 1],
    ]);
  });

  it('오토 모드 종료 요약 스냅샷', () => {
    expect(renderAutoSummary(pictureTree(), review, 'auto')).toMatchSnapshot();
  });

  it('오토가 아니면 묶지 않는다', () => {
    expect(renderAutoSummary(pictureTree(), review, 'normal').split('\n')).toHaveLength(4);
  });
});
