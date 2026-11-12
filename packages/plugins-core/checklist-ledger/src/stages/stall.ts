import { createHash } from 'node:crypto';
import { changeApproachInstruction, STALL_BLOCK_TURNS, STALL_CHANGE_APPROACH_TURNS } from '../stall.js';
import type { StageTree } from './schema.js';
import { currentStage, currentStageItem } from './tree.js';

/**
 * 단계별 정체 감지 (T-101 4F.2)
 * 기준(무변화 턴)은 T-029와 같고, 세는 단위가 단계다: 단계가 바뀌면 0부터 다시 센다.
 * 같은 단계에서 하위 항목·증거가 그대로인 턴이 2번이면 접근 변경, 3번이면 그 단계 항목을 막힘으로 본다.
 */

export type StageStallAction =
  | { action: 'none'; stageId: string | null; unchangedTurns: number }
  | {
      action: 'change_approach';
      stageId: string;
      itemId: string | null;
      unchangedTurns: number;
      instruction: string;
    }
  | { action: 'blocked'; stageId: string; itemId: string | null; unchangedTurns: number; reason: string };

export function stageHash(t: StageTree, stageId: string): string {
  const s = currentStage(t);
  const body =
    s && s.stageId === stageId
      ? { st: s.status, i: s.items.map((i) => [i.id, i.status, i.evidence.length]) }
      : null;
  return createHash('sha256').update(JSON.stringify(body)).digest('hex');
}

export class StageStallDetector {
  private stageId: string | null = null;
  private hash: string | null = null;
  /** 단계 id → 무변화 턴 */
  readonly counts = new Map<string, number>();

  constructor(readonly opts: { changeApproachTurns?: number; blockTurns?: number } = {}) {}

  /** 턴이 끝날 때마다 최신 트리로 부른다 */
  observeTurn(t: StageTree): StageStallAction {
    const s = currentStage(t);
    if (!s) {
      this.stageId = null;
      this.hash = null;
      return { action: 'none', stageId: null, unchangedTurns: 0 };
    }
    const h = stageHash(t, s.stageId);
    const same = s.stageId === this.stageId && h === this.hash;
    const n = same ? (this.counts.get(s.stageId) ?? 0) + 1 : 0;
    this.counts.set(s.stageId, n);
    this.stageId = s.stageId;
    this.hash = h;
    const itemId = currentStageItem(t)?.item.id ?? null;
    const block = this.opts.blockTurns ?? STALL_BLOCK_TURNS;
    const change = this.opts.changeApproachTurns ?? STALL_CHANGE_APPROACH_TURNS;
    if (n >= block) {
      this.counts.set(s.stageId, 0);
      this.hash = null;
      return {
        action: 'blocked',
        stageId: s.stageId,
        itemId,
        unchangedTurns: n,
        reason: `정체: ${s.title} 단계에서 ${n}턴 동안 진척이 없어요`,
      };
    }
    if (n >= change)
      return {
        action: 'change_approach',
        stageId: s.stageId,
        itemId,
        unchangedTurns: n,
        instruction: changeApproachInstruction(itemId ?? s.stageId, n),
      };
    return { action: 'none', stageId: s.stageId, unchangedTurns: n };
  }
}
