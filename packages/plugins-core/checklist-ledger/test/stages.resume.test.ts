import { describe, expect, it } from 'vitest';
import { stageResumeView } from '../src/index.js';
import { pictureTree } from './stages-sample.js';

/** 4F.6 데이터 부분: 3단계 에이전트가 2단계에서 멈춘 상태 → 이어하기 카드·재구성 컨텍스트 */
describe('4F.6 이어하기를 단계 트리 기준으로 (데이터)', () => {
  const t = pictureTree();

  it('카드 진행률 "단계 2/3 · 항목 n/m", 7일 전이면 요약 없음', () => {
    const v = stageResumeView(t, { now: new Date('2026-11-13T00:00:00.000Z') });
    expect(v.progress).toBe('단계 2/3 · 항목 1/4');
    expect(v.recap).toBeNull();
  });

  it('7일 이상 쉬었으면 단계 요약으로 "지금까지"', () => {
    const v = stageResumeView(t, { now: new Date('2026-11-20T00:00:00.000Z') });
    expect(v.recap).toBe('plan: 화면 3개를 고치기로 했어요');
  });

  it('재구성 컨텍스트에 단계 트리 + handoff + 지금 단계 할 일', () => {
    const v = stageResumeView(t, { now: new Date('2026-11-13T00:00:00.000Z') });
    expect(v.context).toMatchSnapshot();
    expect(v.context).toContain('② build 단계 [진행 중] ← 지금');
    expect(v.context).toContain('- plan: {"screens":3}');
  });
});
