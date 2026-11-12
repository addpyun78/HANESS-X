import type { Manifest } from '../manifest.js';
import {
  buildSlice,
  clipBytes,
  SLICE_CLOSE,
  SLICE_MAX_BYTES,
  SLICE_OPEN,
  type ContextSlice,
} from '../slice.js';
import type { Stage, StageTree } from './schema.js';
import { previousHandoff } from './flow.js';
import { allStages, currentStage, getStage, stageChecklist, stageLabel } from './tree.js';

/**
 * 단계 슬라이스 (T-101 4C.2·4C.3)
 * AI에게는 지금 단계 목록 + 앞 단계 요약들 + 받은 값(handoff)만 준다. 다른 단계의 하위 항목은 넣지 않는다.
 * 엔진과 상관없이 같은 형식(같은 함수, 엔진 인자 없음)이고, 전체 2KB 상한을 지킨다.
 */

export interface StageSlice extends ContextSlice {
  stageId: string | null;
}

const bytes = (s: string) => Buffer.byteLength(s, 'utf8');

function headerLines(t: StageTree, cur: Stage, summaryMax: number, handoffMax: number): string[] {
  const k = t.stages.findIndex((s) => s === cur || allStages({ stages: [s] }).includes(cur));
  const lines = [
    `단계 ${k + 1}/${t.stages.length}: ${stageLabel(cur)}${cur.iteration ? ` (반복 ${cur.iteration})` : ''}`,
  ];
  const flat = allStages(t);
  const idx = flat.indexOf(cur);
  const before = flat
    .slice(0, idx)
    .filter((s) => s.status === 'done' && s.summary && !cur.stageId.startsWith(`${s.stageId}.`));
  if (before.length) {
    lines.push('앞 단계 요약:');
    for (const s of before)
      lines.push(`- ${s.title}: ${clipBytes(s.summary!.replace(/\s+/g, ' '), summaryMax)}`);
  }
  const h = previousHandoff(t, cur.stageId);
  if (h && h.output !== undefined)
    lines.push(`받은 값: ${clipBytes(JSON.stringify(h.output) ?? '', handoffMax)}`);
  return lines;
}

/** 지금 단계 슬라이스 (≤ maxBytes). stageId를 주면 그 단계 기준(병렬 갈래마다 따로) */
export function buildStageSlice(
  t: StageTree,
  o: { manifest?: Manifest | null; maxBytes?: number; stageId?: string } = {},
): StageSlice {
  const max = o.maxBytes ?? SLICE_MAX_BYTES;
  const cur = o.stageId ? getStage(t, o.stageId) : currentStage(t);
  if (!cur) {
    const text = `${SLICE_OPEN}\n모든 단계 완료\n${SLICE_CLOSE}`;
    return { text, bytes: bytes(text), itemId: null, stageId: null };
  }
  for (const [summaryMax, handoffMax] of [
    [240, 600],
    [160, 400],
    [96, 240],
    [48, 120],
    [24, 48],
  ] as const) {
    const head = headerLines(t, cur, summaryMax, handoffMax).join('\n');
    // 본문(지금 단계 항목)은 기존 슬라이스로 — 남은 바이트 안에서
    const room = max - bytes(head) - 1;
    if (room < 200) continue;
    const body = buildSlice({ checklist: stageChecklist(cur), manifest: o.manifest ?? null }, room);
    const inner = body.text.slice(SLICE_OPEN.length + 1);
    const text = `${SLICE_OPEN}\n${head}\n${inner}`;
    if (bytes(text) <= max) return { text, bytes: bytes(text), itemId: body.itemId, stageId: cur.stageId };
  }
  const body = buildSlice({ checklist: stageChecklist(cur), manifest: o.manifest ?? null }, max);
  return { ...body, stageId: cur.stageId };
}
