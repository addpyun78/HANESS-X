import { checkPlainKorean } from '@harness-x/approvals';
import { getStage } from '@harness-x/checklist-ledger';
import { describe, expect, it } from 'vitest';
import { THREE } from './stages-pipelines.js';
import { runWithStages } from './stages-run.js';

describe('4C.1 단계 완료 시 handoff 저장: 출력값 + 쉬운 말 3줄 이내 요약', () => {
  it('스냅샷 (쉬운 말·3줄을 못 지킨 요약은 기본 문구로)', async () => {
    const { r, tree } = await runWithStages({
      pipeline: THREE,
      outputs: (node) =>
        ({
          plan: { screens: ['home', 'cfg'], summary: '화면 2개를 고치기로 했어요.' },
          build: { files: 2, summary: 'diff를 regex로 정규화하고 manifest를 커밋했다' },
          test: { passed: 4, summary: '첫째 줄이에요.\n둘째 줄이에요.\n셋째 줄이에요.\n넷째 줄이에요.' },
        })[node],
    });
    expect(r.status).toBe('completed');
    const hs = tree.stages.map((s) => ({ stage: s.stageId, status: s.status, handoff: s.handoff }));
    expect(hs).toMatchSnapshot();
    expect(getStage(tree, 'plan').handoff!.summary).toBe('화면 2개를 고치기로 했어요.');
    for (const s of tree.stages) {
      const lines = s.handoff!.summary.split('\n');
      expect(lines.length).toBeLessThanOrEqual(3);
      for (const l of lines) expect(checkPlainKorean(l).ok, l).toBe(true);
    }
  });
});
