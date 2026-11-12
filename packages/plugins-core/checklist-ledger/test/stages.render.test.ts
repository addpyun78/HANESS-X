import { describe, expect, it } from 'vitest';
import { buildSkeleton, renderStageTreeMarkdown, startIteration } from '../src/index.js';
import { FIXED_NOW, P, templates } from './stages-helpers.js';
import { pictureTree } from './stages-sample.js';

describe('4F.3 CHECKLIST.md 렌더: 단계별 섹션 + 단계 요약', () => {
  it('설계 그림 모양 스냅샷', () => {
    const md = renderStageTreeMarkdown(pictureTree());
    expect(md).toMatchSnapshot();
    expect(md).toContain('## ① plan 단계 [완료]');
    expect(md).toContain('요약: 화면 3개를 고치기로 했어요');
    expect(md).toContain('## ② build 단계 [진행 중]');
    expect(md).toContain('## ③ critic 단계 [예상]');
    expect(md).toContain('(재작업 r1 — critic 지적)');
  });

  it('반복 회차는 하위 섹션으로', () => {
    const LOOP = P({
      name: 'polish',
      entry: 'again',
      nodes: [
        { id: 'again', type: 'loop', maxIterations: 3 },
        { id: 'fix', type: 'role' },
      ],
      edges: [
        { from: 'again', to: 'fix' },
        { from: 'fix', to: 'again' },
      ],
    });
    let t = buildSkeleton({
      sessionId: 's',
      agent: { name: 'polish', pipeline: LOOP },
      templates,
      now: FIXED_NOW,
    });
    t = startIteration(t, 'again', 1, LOOP, { templates, now: FIXED_NOW });
    expect(renderStageTreeMarkdown(t)).toMatchSnapshot();
  });
});
