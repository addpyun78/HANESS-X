import {
  advanceStage,
  buildSkeleton,
  completeStage,
  markItemsDone,
  saveHandoff,
  type StageTree,
} from '../src/index.js';
import { FIXED_NOW, P, templates } from './stages-helpers.js';

/** plan → build → critic (설계 그림과 같은 모양) */
export const PIC = P({
  name: 'pic',
  nodes: [
    { id: 'plan', type: 'role' },
    { id: 'build', type: 'role' },
    { id: 'critic', type: 'gate' },
  ],
  edges: [
    { from: 'plan', to: 'build' },
    { from: 'build', to: 'critic' },
    { from: 'critic', to: 'build', onFail: true },
  ],
});

/** 설계 그림: ① plan 완료(요약) ② build 진행 중(틀·제안·재작업 r1) ③ critic 예상 */
export function pictureTree(): StageTree {
  let t = buildSkeleton({ sessionId: 's', agent: { name: 'pic', pipeline: PIC }, templates, now: FIXED_NOW });
  t = markItemsDone(advanceStage(t, 'plan', 'running', FIXED_NOW), 'plan', undefined, FIXED_NOW);
  t = completeStage(t, 'plan', {
    handoff: { output: { screens: 3 }, summary: '화면 3개를 고치기로 했어요' },
    now: FIXED_NOW,
  }).tree;
  t = advanceStage(t, 'build', 'running', FIXED_NOW);
  t = structuredClone(t);
  const b = t.stages[1]!;
  b.items[0]!.status = 'done';
  b.items[1]!.status = 'doing';
  b.items.push({ ...b.items[0]!, id: 'b-home', title: '홈 화면 만들기', status: 'todo' });
  b.itemMeta['b-home'] = { origin: 'proposed' };
  b.items.push({ ...b.items[0]!, id: 'build-r1', title: '다시 하기: 버튼 글자가 작아요', status: 'todo' });
  b.itemMeta['build-r1'] = { origin: 'rework', rework: 1, gateStageId: 'critic', note: '버튼 글자가 작아요' };
  return saveHandoff(
    t,
    'plan',
    { output: { screens: 3 }, summary: '화면 3개를 고치기로 했어요' },
    { now: FIXED_NOW },
  );
}
