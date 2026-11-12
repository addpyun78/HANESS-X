import type { PipelineInput } from '@harness-x/protocol';
import { dryRunOrder, type Overlay, type OverlayStatus } from './dryrun.js';

/**
 * T-101 4F.5 시험 실행 오버레이의 단계별 진행.
 * 단계 = 에이전트 파일의 노드 중 일을 하는 노드(role·gate·join·subagent·loop). fanout·router는 길만 나눈다.
 */

const STAGE_TYPES = new Set(['role', 'gate', 'join', 'subagent', 'loop']);

export interface StageRow {
  nodeId: string;
  title: string;
  status: OverlayStatus;
}

export interface StageRunView {
  rows: StageRow[];
  /** "단계 2/3" */
  label: string;
}

export function stageRunView(p: PipelineInput, overlay: Overlay | undefined): StageRunView {
  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  const order = dryRunOrder(p);
  const ids = [...order, ...p.nodes.map((n) => n.id).filter((id) => !order.includes(id))].filter((id) =>
    STAGE_TYPES.has(byId.get(id)?.type ?? ''),
  );
  const rows = ids.map((id) => ({
    nodeId: id,
    title: byId.get(id)?.label ?? id,
    status: overlay?.[id]?.status ?? ('pending' as OverlayStatus),
  }));
  const running = rows.findIndex((r) => r.status === 'running');
  const done = rows.filter((r) => r.status === 'completed').length;
  const k = running >= 0 ? running + 1 : Math.min(Math.max(done, 1), rows.length);
  return { rows, label: `단계 ${k}/${rows.length}` };
}
