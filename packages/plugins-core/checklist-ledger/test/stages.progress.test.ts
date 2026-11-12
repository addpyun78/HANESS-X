import { describe, expect, it } from 'vitest';
import { buildSkeleton, stageProgress } from '../src/index.js';
import { FIXED_NOW, item } from './stages-helpers.js';
import { pictureTree } from './stages-sample.js';

describe('4F.8 사이드바 세션 줄용 단계 진행 "단계 2/3" (단계 1개면 표시 안 함)', () => {
  it('3단계 중 2단계 진행 중', () => {
    expect(stageProgress(pictureTree())).toEqual({
      stageIndex: 2,
      stageTotal: 3,
      stagesDone: 1,
      itemDone: 1,
      itemTotal: 4,
      label: '단계 2/3 · 이번 단계 항목 1/4',
      resumeLabel: '단계 2/3 · 항목 1/4',
      short: '단계 2/3',
    });
  });

  it('단계 1개면 단계 글자 없음', () => {
    const t = buildSkeleton({ sessionId: 's', items: [item('1'), item('2')], now: FIXED_NOW });
    const p = stageProgress(t);
    expect(p.short).toBeNull();
    expect(p.label).toBe('항목 0/2');
  });
});
