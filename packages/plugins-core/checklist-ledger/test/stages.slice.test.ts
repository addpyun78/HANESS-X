import { describe, expect, it } from 'vitest';
import {
  SLICE_MAX_BYTES,
  advanceStage,
  buildSkeleton,
  buildStageSlice,
  completeStage,
  markItemsDone,
  type StageTree,
} from '../src/index.js';
import { FIXED_NOW, THREE, item, templates } from './stages-helpers.js';

function atBuild(): StageTree {
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
  return advanceStage(t, 'build', 'running');
}

describe('4C.2 단계 슬라이스: 현재 단계 목록 + 앞 단계 요약 + handoff 값만', () => {
  it('스냅샷', () => {
    expect(buildStageSlice(atBuild()).text).toMatchSnapshot();
  });

  it('다른 단계 하위 항목 0건', () => {
    const s = buildStageSlice(atBuild());
    expect(s.stageId).toBe('build');
    expect(s.text).toContain('단계 2/3: build 단계');
    expect(s.text).toContain('앞 단계 요약:\n- plan: 화면 2개를 만들기로 했어요');
    expect(s.text).toContain('받은 값: {"screens":["home","cfg"]}');
    expect(s.text).toContain('build1');
    for (const other of ['plan1', 'plan2', 'test1', 'test2']) expect(s.text).not.toContain(other);
  });

  it('2KB 상한 유지 (긴 요약·큰 handoff·항목 100개)', () => {
    let t = atBuild();
    t = structuredClone(t);
    t.stages[0]!.summary = '아주 긴 요약이에요. '.repeat(200);
    t.stages[0]!.handoff!.output = { blob: 'x'.repeat(10_000) };
    t.stages[1]!.items = Array.from(
      { length: 100 },
      (_, k) =>
        ({
          ...(item(`b${k}`, { title: '긴 제목 '.repeat(50) }) as object),
          parent: null,
          owner: null,
          deps: [],
          status: 'todo',
          attempts: 0,
          evidence: [],
        }) as never,
    );
    const s = buildStageSlice(t);
    expect(s.bytes).toBeLessThanOrEqual(SLICE_MAX_BYTES);
    expect(Buffer.byteLength(s.text, 'utf8')).toBe(s.bytes);
    expect(s.text.startsWith('<harness-checklist>')).toBe(true);
    expect(s.text.endsWith('</harness-checklist>')).toBe(true);
  });
});
