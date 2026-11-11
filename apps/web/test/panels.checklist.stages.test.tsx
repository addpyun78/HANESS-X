// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ChecklistPanel } from '../src/panels/Checklist/ChecklistPanel.js';
import type { ChecklistItem, ChecklistView } from '../src/panels/Checklist/model.js';
import { stageProgressLabel, type StageTreeView } from '../src/panels/Checklist/stages.js';

afterEach(cleanup);

const item = (id: string, title: string, status: ChecklistItem['status']): ChecklistItem => ({
  id,
  parent: null,
  title,
  owner: null,
  deps: [],
  artifactId: 'art.app',
  acceptance: [{ type: 'command', run: 'true' }],
  status,
  attempts: 0,
  evidence: [],
});

/** 설계 그림: ① plan 완료(요약) ② build 진행 중 ③ critic 예상 */
export const STAGES: StageTreeView = {
  agent: 'design-qa',
  stages: [
    {
      stageId: 'plan',
      nodeId: 'plan',
      title: 'plan',
      kind: 'role',
      status: 'done',
      summary: '화면 3개를 고치기로 했어요',
      items: [item('plan1', '화면 목록 정하기', 'done'), item('plan2', '고칠 순서 정하기', 'done')],
      itemMeta: { plan1: { origin: 'template' }, plan2: { origin: 'proposed' } },
      children: [],
    },
    {
      stageId: 'build',
      nodeId: 'build',
      title: 'build',
      kind: 'role',
      status: 'running',
      items: [
        item('build1', '로그인 화면 고치기', 'done'),
        item('build2', '홈 화면 고치기', 'doing'),
        item('build3', '설정 화면 고치기', 'todo'),
        item('build-r1', '다시 하기: 버튼 글자가 작아요', 'todo'),
      ],
      itemMeta: {
        build1: { origin: 'template' },
        build2: { origin: 'proposed' },
        build3: { origin: 'proposed' },
        'build-r1': { origin: 'rework', rework: 1, gateStageId: 'critic' },
      },
      children: [],
    },
    {
      stageId: 'critic',
      nodeId: 'critic',
      title: 'critic',
      kind: 'gate',
      status: 'expected',
      items: [item('critic1', '글자 대비 검사하기', 'todo')],
      itemMeta: { critic1: { origin: 'template' } },
      children: [],
    },
  ],
};

const view = (stages: StageTreeView | null): ChecklistView => ({
  sessionId: 's-stage',
  checklist: {
    revision: 1,
    version: 3,
    updatedAt: '2026-11-12T00:00:00.000Z',
    items: STAGES.stages[1]!.items,
  },
  currentItemId: 'build2',
  plan: { locked: true, revision: 1, artifacts: {} },
  lint: { ok: true, violations: [] },
  stages,
});

describe('4F.4 체크리스트 패널: 단계 트리', () => {
  it('진행률 "단계 2/3 · 이번 단계 항목 1/4"', () => {
    expect(stageProgressLabel(STAGES)).toEqual({ label: '단계 2/3 · 이번 단계 항목 1/4', short: '단계 2/3' });
  });

  it('현재 단계 펼침 · 끝난 단계 접힘+요약 · 예상 단계 흐리게 (스냅샷)', () => {
    const { container } = render(<ChecklistPanel events={[]} initialView={view(STAGES)} />);
    expect(screen.getByTestId('stage-progress').textContent).toBe('단계 2/3 · 이번 단계 항목 1/4');
    const li = (id: string) => container.querySelector(`[data-stage-id="${id}"]`)!;
    expect(li('plan').querySelector('details')!.open).toBe(false);
    expect(within(li('plan') as HTMLElement).getByText('화면 3개를 고치기로 했어요')).toBeTruthy();
    expect(li('build').querySelector('details')!.open).toBe(true);
    expect(li('critic').querySelector('details')!.open).toBe(false);
    expect(li('critic').className).toContain('hx-ck-stage--expected');
    expect(within(li('build') as HTMLElement).getByText('다시 하기 1')).toBeTruthy();
    expect(li('critic').textContent).toContain('◌');
    expect(container.querySelector('.hx-ck-stages')!.outerHTML).toMatchSnapshot();
  });

  it('단계 1개(또는 단계 정보 없음)면 기존 평평한 목록 그대로', () => {
    render(<ChecklistPanel events={[]} initialView={view(null)} />);
    expect(screen.queryByTestId('stage-progress')).toBeNull();
    expect(screen.getByTestId('checklist-progress')).toBeTruthy();
  });
});
