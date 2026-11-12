import { describe, expect, it } from 'vitest';
import {
  advanceStage,
  buildSkeleton,
  completeStage,
  enterStage,
  getStage,
  markItemsDone,
  type ChecklistItemInput,
  type Handoff,
} from '../src/index.js';
import { FIXED_NOW, THREE, item, templates } from './stages-helpers.js';

/** 리플레이: plan 단계가 넘긴 값 → build 노드 AI가 낸 제안 (녹화본) */
const RECORDED: ChecklistItemInput[] = [
  item('build1', { title: 'build 틀 항목 1 쓰기' }), // 틀과 같은 id → 합침
  item('b-login', { title: '  BUILD 틀 항목 2 쓰기 ' }), // 틀과 같은 제목 → 합침
  item('b-home', { title: '홈 화면 만들기', artifactId: 'art.home' }),
  item('b-big', { title: '로그인 만들고 홈도 고치기' }), // 동사 2개 → 린터 탈락
  item('b-cfg', { title: '설정 화면 만들기', artifactId: 'art.cfg' }),
];

describe('4B.2 단계 진입: handoff → 노드 AI 제안 → 원자성 린터 → 틀과 합치기', () => {
  it('리플레이', async () => {
    let t = buildSkeleton({
      sessionId: 's',
      agent: { name: 'three', pipeline: THREE },
      templates,
      now: FIXED_NOW,
    });
    t = markItemsDone(advanceStage(t, 'plan', 'running'), 'plan');
    t = completeStage(t, 'plan', {
      handoff: { output: { screens: ['home', 'cfg'] }, summary: '화면 2개를 만들기로 했어요' },
    }).tree;
    let seen: Handoff | undefined;
    const r = await enterStage(t, 'build', {
      propose: ({ handoff }) => {
        seen = handoff;
        return RECORDED;
      },
      now: FIXED_NOW,
    });
    expect(seen?.output).toEqual({ screens: ['home', 'cfg'] });
    expect(r.merged).toEqual(['build1', 'b-login']);
    expect(r.violations.map((v) => [v.rule, v.itemId])).toEqual([['R1', 'b-big']]);
    expect(r.added).toEqual(['b-home', 'b-cfg']);
    const s = getStage(r.tree, 'build');
    expect(s.status).toBe('planning');
    expect(s.items.map((i) => `${i.id}:${s.itemMeta[i.id]!.origin}`)).toEqual([
      'build1:template',
      'build2:template',
      'b-home:proposed',
      'b-cfg:proposed',
    ]);
  });

  it('제안기가 없으면 틀 항목만으로 planning', async () => {
    const t = buildSkeleton({ sessionId: 's', agent: { name: 'three', pipeline: THREE }, templates });
    const r = await enterStage(t, 'plan');
    expect(getStage(r.tree, 'plan').items.map((i) => i.id)).toEqual(['plan1', 'plan2']);
  });
});
