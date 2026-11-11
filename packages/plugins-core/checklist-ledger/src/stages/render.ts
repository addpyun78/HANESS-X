import type { Manifest } from '../manifest.js';
import type { ChecklistItem } from '../schema.js';
import type { Stage, StageStatus, StageTree } from './schema.js';
import { allStages, currentStage, currentTopStage, stageLabel } from './tree.js';

/**
 * 단계 트리 보여 주기 (T-101 4F.3·4F.4·4F.6·4F.7·4F.8)
 *  - CHECKLIST.md: 단계별 섹션 + 단계 요약
 *  - 진행률: "단계 2/3 · 이번 단계 항목 4/7" (단계 1개면 단계 표시 없음)
 *  - 이어하기 카드·재구성 컨텍스트, 오토 모드 종료 요약을 단계별로 묶기
 */

export const STAGE_STATUS_LABELS: Record<StageStatus, string> = {
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

const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
export function circled(n: number): string {
  return CIRCLED[n - 1] ?? `(${n})`;
}

/** 하위 항목 아이콘: ✓ 완료 / ● 진행 / ○ 할 일 / ◌ 예상(단계가 아직 예상) / ✕ 실패 / ⛔ 막힘 */
export function itemIcon(it: Pick<ChecklistItem, 'status'>, stage: Pick<Stage, 'status'>): string {
  if (stage.status === 'expected' || stage.status === 'skipped') return '◌';
  switch (it.status) {
    case 'done':
      return '✓';
    case 'doing':
    case 'verifying':
      return '●';
    case 'failed':
      return '✕';
    case 'blocked':
      return '⛔';
    default:
      return '○';
  }
}

function itemNote(s: Stage, it: ChecklistItem): string {
  const m = s.itemMeta[it.id];
  if (!m) return '';
  if (m.origin === 'rework')
    return ` (재작업 r${m.rework}${m.gateStageId ? ` — ${m.gateStageId} 지적` : ''}${m.link ? `, [원문](${m.link})` : ''})`;
  if (m.origin === 'template') return ' (틀)';
  return '';
}

const one = (s: string) => s.replace(/\s+/g, ' ').trim();

/** 4F.3 CHECKLIST.md (단계별 섹션 + 단계 요약) */
export function renderStageTreeMarkdown(
  t: StageTree,
  o: { title?: string; manifest?: Manifest | null } = {},
): string {
  const p = stageProgress(t);
  const lines = [`# ${o.title ?? '세션 체크리스트'}`, ''];
  lines.push(
    `${p.stageTotal > 1 ? `${p.label}` : `항목 ${p.itemDone}/${p.itemTotal}`} — 모든 단계가 끝나야 세션이 끝나요.`,
    '',
  );
  const section = (s: Stage, num: string, depth: number) => {
    const h = '#'.repeat(Math.min(2 + depth, 6));
    const meta = [STAGE_STATUS_LABELS[s.status]];
    if (s.engineId) meta.push(s.engineId);
    lines.push(`${h} ${num} ${stageLabel(s)} [${meta.join(' · ')}]`);
    if (s.summary) lines.push('', `요약: ${one(s.summary)}`);
    if (s.reason && (s.status === 'skipped' || s.status === 'blocked' || s.status === 'reopened'))
      lines.push('', `이유: ${one(s.reason)}`);
    if (s.items.length) {
      lines.push('');
      s.items.forEach((it, k) => {
        const path = o.manifest?.artifacts[it.artifactId]?.path;
        lines.push(
          `- ${itemIcon(it, s)} ${num.replace(/[①-⑳]/, (c) => String(CIRCLED.indexOf(c) + 1))}.${k + 1} ${one(it.title)}${itemNote(s, it)}${path ? ` — \`${path}\`` : ''}`,
        );
      });
    }
    lines.push('');
    s.children.forEach((c, k) => section(c, `${num}.${k + 1}`, depth + 1));
  };
  t.stages.forEach((s, k) => section(s, circled(k + 1), 0));
  return lines.join('\n');
}

// ── 진행률 ───────────────────────────────────────────────────
export interface StageProgress {
  /** 지금 단계 번호 (1부터, 모두 끝났으면 stageTotal) */
  stageIndex: number;
  stageTotal: number;
  stagesDone: number;
  itemDone: number;
  itemTotal: number;
  /** "단계 2/3 · 이번 단계 항목 4/7" (단계 1개면 "항목 4/7") */
  label: string;
  /** 이어하기 카드용 "단계 2/3 · 항목 4/7" */
  resumeLabel: string;
  /** 사이드바용 "단계 2/3" (단계 1개면 null — 표시 안 함) */
  short: string | null;
}

function stageItems(s: Stage): ChecklistItem[] {
  return [s, ...allStages({ stages: s.children })].flatMap((x) => (x.status === 'skipped' ? [] : x.items));
}

export function stageProgress(t: Pick<StageTree, 'stages'>): StageProgress {
  const total = t.stages.length;
  const top = currentTopStage(t);
  const done = t.stages.filter((s) => s.status === 'done' || s.status === 'skipped').length;
  const idx = top ? t.stages.indexOf(top) + 1 : total;
  const items = top ? stageItems(top) : [];
  const itemDone = items.filter((i) => i.status === 'done').length;
  const itemTotal = items.length;
  const short = total > 1 ? `단계 ${idx}/${total}` : null;
  return {
    stageIndex: idx,
    stageTotal: total,
    stagesDone: done,
    itemDone,
    itemTotal,
    label: short ? `${short} · 이번 단계 항목 ${itemDone}/${itemTotal}` : `항목 ${itemDone}/${itemTotal}`,
    resumeLabel: short ? `${short} · 항목 ${itemDone}/${itemTotal}` : `항목 ${itemDone}/${itemTotal}`,
    short,
  };
}

// ── 4F.6 이어하기 ─────────────────────────────────────────────
export const LONG_PAUSE_MS = 7 * 24 * 60 * 60 * 1000;

export interface StageResumeView {
  progress: string;
  /** 7일 이상 쉬었으면 단계 요약으로 만든 "지금까지" (아니면 null) */
  recap: string | null;
  /** 재구성 컨텍스트 (단계 트리 + handoff) */
  context: string;
}

export function stageResumeView(
  t: StageTree,
  o: { now?: Date; lastActiveAt?: string } = {},
): StageResumeView {
  const now = o.now ?? new Date();
  const last = new Date(o.lastActiveAt ?? t.updatedAt).getTime();
  const long = now.getTime() - last >= LONG_PAUSE_MS;
  const done = allStages(t).filter((s) => s.status === 'done' && s.summary);
  const recap = long
    ? done.length
      ? done.map((s) => `${s.title}: ${one(s.summary!)}`).join('\n')
      : '아직 끝낸 단계가 없어요.'
    : null;
  const cur = currentStage(t);
  const ctx = ['## 단계 트리'];
  const walk = (l: readonly Stage[], depth: number) =>
    l.forEach((s, k) => {
      const pad = '  '.repeat(depth);
      const n = depth === 0 ? circled(k + 1) : `${k + 1}.`;
      ctx.push(
        `${pad}${n} ${stageLabel(s)} [${STAGE_STATUS_LABELS[s.status]}]${s.summary ? ` — ${one(s.summary)}` : ''}${s === cur ? ' ← 지금' : ''}`,
      );
      walk(s.children, depth + 1);
    });
  walk(t.stages, 0);
  const hs = allStages(t).filter((s) => s.handoff);
  if (hs.length) {
    ctx.push('', '## 단계가 넘긴 값');
    for (const s of hs) ctx.push(`- ${s.title}: ${JSON.stringify(s.handoff!.output)}`);
  }
  if (cur?.items.length) {
    ctx.push('', `## 지금 단계(${cur.title}) 할 일`);
    for (const it of cur.items) ctx.push(`- ${itemIcon(it, cur)} ${it.id}: ${one(it.title)}`);
  }
  return { progress: stageProgress(t).resumeLabel, recap, context: ctx.join('\n') };
}

// ── 4F.7 오토 모드 "돌아오면 확인할 것"·종료 요약 묶기 ────────────
export interface ReviewEntry {
  /** 어느 단계에서 생긴 일인지 (없으면 "공통") */
  stageId?: string;
  text: string;
}

export interface StageGroup<T> {
  stageId: string | null;
  title: string;
  entries: T[];
}

/** 확인할 것·요약 줄을 단계별로 묶는다 (단계 순서, 없는 단계는 "공통") */
export function groupByStage<T extends { stageId?: string }>(
  t: Pick<StageTree, 'stages'>,
  entries: readonly T[],
): StageGroup<T>[] {
  const flat = allStages(t);
  const out: StageGroup<T>[] = [];
  for (const s of flat) {
    const mine = entries.filter((e) => e.stageId === s.stageId);
    if (mine.length) out.push({ stageId: s.stageId, title: stageLabel(s), entries: mine });
  }
  const rest = entries.filter((e) => !e.stageId || !flat.some((s) => s.stageId === e.stageId));
  if (rest.length) out.push({ stageId: null, title: '공통', entries: rest });
  return out;
}

/** 오토 모드 종료 요약 (모드는 인자 — 오토가 아니면 단계 묶음 없이 한 줄씩) */
export function renderAutoSummary(
  t: StageTree,
  review: readonly ReviewEntry[],
  mode: 'plan' | 'normal' | 'auto',
): string {
  if (mode !== 'auto') return review.map((r) => `- ${r.text}`).join('\n');
  const lines = [`## 끝난 뒤 요약 (${stageProgress(t).label})`];
  for (const s of t.stages)
    lines.push(
      `- ${stageLabel(s)}: ${STAGE_STATUS_LABELS[s.status]}${s.summary ? ` — ${one(s.summary)}` : ''}`,
    );
  const groups = groupByStage(t, review);
  if (groups.length) {
    lines.push('', '## 돌아오면 확인할 것');
    for (const g of groups) {
      lines.push(`### ${g.title}`);
      for (const e of g.entries) lines.push(`- ${e.text}`);
    }
  }
  return lines.join('\n') + '\n';
}
