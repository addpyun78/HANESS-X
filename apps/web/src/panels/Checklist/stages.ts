import type { ChecklistItem } from './model.js';

/**
 * 단계 트리 보기 모델 (T-101 4F.4)
 * 서버 GET /api/checklist/:session 의 `stages`(checklist-ledger StageTree)와 같은 모양에서 필요한 필드만.
 * 웹은 checklist-ledger(node 전용)에 의존하지 않으므로 진행률 계산(stageProgress)을 같은 규칙으로 옮겨 둔다.
 */

export type StageStatus =
  | 'expected'
  | 'planning'
  | 'locked'
  | 'running'
  | 'verifying'
  | 'done'
  | 'reopened'
  | 'needs-recheck'
  | 'skipped'
  | 'blocked';

export interface StageItemMeta {
  origin: 'template' | 'proposed' | 'rework' | 'ledger';
  rework?: number;
  gateStageId?: string;
  note?: string;
}

export interface StageView {
  stageId: string;
  nodeId: string | null;
  title: string;
  kind: string;
  status: StageStatus;
  summary?: string;
  iteration?: number;
  reason?: string;
  items: ChecklistItem[];
  itemMeta: Record<string, StageItemMeta>;
  children: StageView[];
}

export interface StageTreeView {
  agent: string | null;
  stages: StageView[];
}

export const STAGE_STATUS_LABEL: Record<StageStatus, string> = {
  expected: '예상',
  planning: '계획 중',
  locked: '확정',
  running: '진행 중',
  verifying: '확인 중',
  done: '완료',
  reopened: '다시 하는 중',
  'needs-recheck': '다시 확인 필요',
  skipped: '건너뜀',
  blocked: '막힘',
};

const ACTIVE: readonly StageStatus[] = [
  'planning',
  'locked',
  'running',
  'verifying',
  'reopened',
  'needs-recheck',
];

export const isActiveStage = (s: Pick<StageView, 'status'>) => ACTIVE.includes(s.status);
export const isFinishedStage = (s: Pick<StageView, 'status'>) =>
  s.status === 'done' || s.status === 'skipped';

export function currentTopStage(t: Pick<StageTreeView, 'stages'>): StageView | undefined {
  return (
    t.stages.find(isActiveStage) ??
    t.stages.find((s) => s.status === 'blocked') ??
    t.stages.find((s) => s.status === 'expected')
  );
}

function stageItems(s: StageView): ChecklistItem[] {
  if (s.status === 'skipped') return [];
  return [...s.items, ...s.children.flatMap(stageItems)];
}

/** "단계 2/3 · 이번 단계 항목 4/7" (단계 1개면 "항목 4/7"), short = "단계 2/3" | null */
export function stageProgressLabel(t: Pick<StageTreeView, 'stages'>): {
  label: string;
  short: string | null;
} {
  const total = t.stages.length;
  const top = currentTopStage(t);
  const idx = top ? t.stages.indexOf(top) + 1 : total;
  const items = top ? stageItems(top) : [];
  const done = items.filter((i) => i.status === 'done').length;
  const short = total > 1 ? `단계 ${idx}/${total}` : null;
  const itemsText = `항목 ${done}/${items.length}`;
  return { label: short ? `${short} · 이번 ${itemsText.replace('항목', '단계 항목')}` : itemsText, short };
}

const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
export const circled = (n: number) => CIRCLED[n - 1] ?? `(${n})`;

export const stageName = (s: Pick<StageView, 'title' | 'kind'>) =>
  s.kind === 'iteration' || s.kind === 'task' ? s.title : `${s.title} 단계`;

/** 하위 항목 아이콘: ✓ 완료 / ● 진행 / ○ 할 일 / ◌ 예상 */
export function stageItemIcon(it: Pick<ChecklistItem, 'status'>, s: Pick<StageView, 'status'>): string {
  if (s.status === 'expected' || s.status === 'skipped') return '◌';
  if (it.status === 'done') return '✓';
  if (it.status === 'doing' || it.status === 'verifying') return '●';
  if (it.status === 'failed') return '✕';
  if (it.status === 'blocked') return '⊘';
  return '○';
}
