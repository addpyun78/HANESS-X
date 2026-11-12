import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * T-101 4F.6·4F.8 단계 진행 읽기 (커널 쪽)
 * 단계 트리 원본은 checklist-ledger의 stages.json(<workspace>/.harness-x/sessions/<id>/stages.json).
 * 커널은 checklist-ledger에 의존할 수 없어(반대 방향 의존) 필요한 필드만 읽고, 진행률 규칙은
 * checklist-ledger stageProgress·stageResumeView와 같게 둔다 (checklist-ledger 테스트가 두 결과를 비교한다).
 */

export interface StageItemLike {
  id: string;
  title: string;
  status: string;
}

export interface StageLike {
  stageId: string;
  title: string;
  kind: string;
  status: string;
  summary?: string;
  items: StageItemLike[];
  handoff?: { output?: unknown };
  children: StageLike[];
}

export interface StageTreeLike {
  stages: StageLike[];
}

const ACTIVE = ['planning', 'locked', 'running', 'verifying', 'reopened', 'needs-recheck'];

function isStage(v: unknown): v is StageLike {
  const s = v as StageLike;
  return (
    !!s &&
    typeof s.stageId === 'string' &&
    typeof s.status === 'string' &&
    Array.isArray(s.items) &&
    Array.isArray(s.children) &&
    s.children.every(isStage)
  );
}

/** stages.json 읽기 (없거나 모양이 다르면 null) */
export function readStageTree(file: string): StageTreeLike | null {
  if (!existsSync(file)) return null;
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as { stages?: unknown };
    if (!Array.isArray(raw.stages) || !raw.stages.length || !raw.stages.every(isStage)) return null;
    return { stages: raw.stages };
  } catch {
    return null;
  }
}

/** 세션 id → 단계 트리 (실행기 workspace 기준) */
export function stageTreeResolver(workspace: string): (sessionId: string) => StageTreeLike | null {
  return (id) =>
    /^[A-Za-z0-9._-]{1,128}$/.test(id) && id !== '.' && id !== '..'
      ? readStageTree(join(workspace, '.harness-x', 'sessions', id, 'stages.json'))
      : null;
}

function currentTop(t: StageTreeLike): StageLike | undefined {
  return (
    t.stages.find((s) => ACTIVE.includes(s.status)) ??
    t.stages.find((s) => s.status === 'blocked') ??
    t.stages.find((s) => s.status === 'expected')
  );
}

function itemsOf(s: StageLike): StageItemLike[] {
  if (s.status === 'skipped') return [];
  return [...s.items, ...s.children.flatMap(itemsOf)];
}

export interface StageProgressLabels {
  /** 사이드바 "단계 2/3" (단계 1개면 null) */
  short: string | null;
  /** 이어하기 카드 "단계 2/3 · 항목 4/7" (단계 1개면 "항목 4/7") */
  resume: string;
}

export function stageProgressLabels(t: StageTreeLike): StageProgressLabels {
  const total = t.stages.length;
  const top = currentTop(t);
  const idx = top ? t.stages.indexOf(top) + 1 : total;
  const items = top ? itemsOf(top) : [];
  const done = items.filter((i) => i.status === 'done').length;
  const short = total > 1 ? `단계 ${idx}/${total}` : null;
  const its = `항목 ${done}/${items.length}`;
  return { short, resume: short ? `${short} · ${its}` : its };
}

function flat(l: readonly StageLike[]): StageLike[] {
  return l.flatMap((s) => [s, ...flat(s.children)]);
}

const one = (s: string) => s.replace(/\s+/g, ' ').trim();
const label = (s: StageLike) => (s.kind === 'iteration' || s.kind === 'task' ? s.title : `${s.title} 단계`);

/** 7일 이상 쉰 세션의 "지금까지 한 일": 끝난 단계의 요약 */
export function stageRecap(t: StageTreeLike): { id: string; title: string }[] {
  return flat(t.stages)
    .filter((s) => s.status === 'done' && s.summary)
    .map((s) => ({ id: s.stageId, title: `${s.title}: ${one(s.summary!)}` }));
}

/** 이어하기 재구성 컨텍스트에 넣을 단계 트리 + handoff */
export function stageContext(t: StageTreeLike): string {
  const cur = currentTop(t);
  const lines = ['단계 트리:'];
  const walk = (l: readonly StageLike[], depth: number) =>
    l.forEach((s, k) => {
      const n = depth === 0 ? `${k + 1})` : `${k + 1}.`;
      lines.push(
        `${'  '.repeat(depth)}${n} ${label(s)} [${s.status}]${s.summary ? ` — ${one(s.summary)}` : ''}${s === cur ? ' ← 지금' : ''}`,
      );
      walk(s.children, depth + 1);
    });
  walk(t.stages, 0);
  const hs = flat(t.stages).filter((s) => s.handoff && s.handoff.output !== undefined);
  if (hs.length) {
    lines.push('단계가 넘긴 값:');
    for (const s of hs) lines.push(`- ${s.title}: ${JSON.stringify(s.handoff!.output)}`);
  }
  return lines.join('\n');
}
