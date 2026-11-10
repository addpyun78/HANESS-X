import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { writeFileAtomic } from './fs-util.js';
import { currentItemOf } from './ledger.js';
import type { Manifest } from './manifest.js';
import { lastFailureReason } from './slice.js';
import { ITEM_STATUSES, type Checklist, type ChecklistItem, type ItemStatus } from './schema.js';
import { nextInstruction } from './stop-guard.js';

/**
 * 내보내기 (T-029 29.5·29.6)
 *  - CHECKLIST.md: 사람이 읽는 체크리스트 (상태 아이콘·판정 사유)
 *  - CHECKPOINT.json + MISSION.md: HARNESS v2 호환 체크포인트
 *
 * HARNESS v2 형식 주의: 저장소에 v2 형식의 공식 명세가 없다. 이 형식은 v1 계획서의 "HARNESS v2 체크포인트"
 * 개념(미션 문서 + 진행 상태 + 다음 행동)을 바탕으로 이 저장소에서 정의한 것이다. 기계 판독 스키마는
 * schemas/harness-v2-checkpoint.schema.json (HarnessV2CheckpointSchema에서 생성, 테스트가 일치를 확인)이다.
 */

export const STATUS_ICONS: Record<ItemStatus, string> = {
  todo: '⬜',
  doing: '🔄',
  verifying: '🔍',
  done: '✅',
  failed: '❌',
  blocked: '⛔',
};

export interface RenderOptions {
  title?: string;
  manifest?: Manifest | null;
}

function oneLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** 29.5 CHECKLIST.md */
export function renderChecklistMarkdown(c: Checklist | null, opts: RenderOptions = {}): string {
  const lines = [`# ${opts.title ?? '체크리스트'}`, ''];
  if (!c) return [...lines, '체크리스트 없음', ''].join('\n');
  const done = c.items.filter((i) => i.status === 'done').length;
  const cur = currentItemOf(c);
  lines.push(`개정 v${c.revision} · 버전 ${c.version} · 진행 ${done}/${c.items.length}`);
  if (cur) lines.push(`현재 항목: ${cur.id}`);
  lines.push('', '범례: ' + ITEM_STATUSES.map((s) => `${STATUS_ICONS[s]} ${s}`).join(' · '), '');

  const ids = new Set(c.items.map((i) => i.id));
  const children = new Map<string | null, ChecklistItem[]>();
  for (const it of c.items) {
    const p = it.parent && ids.has(it.parent) ? it.parent : null;
    children.set(p, [...(children.get(p) ?? []), it]);
  }
  const walk = (parent: string | null, depth: number) => {
    for (const it of children.get(parent) ?? []) {
      const pad = '  '.repeat(depth);
      const path = opts.manifest?.artifacts[it.artifactId]?.path;
      const meta = [`\`${path ?? it.artifactId}\``];
      if (it.attempts) meta.push(`시도 ${it.attempts}`);
      if (it.deps.length) meta.push(`의존 ${it.deps.join(', ')}`);
      lines.push(
        `${pad}- ${STATUS_ICONS[it.status]} **${it.id}** ${oneLine(it.title)} — ${meta.join(' · ')}`,
      );
      if (it.verdict)
        lines.push(
          `${pad}  - 판정: L${it.verdict.level} ${it.verdict.verdict} (${it.verdict.confidence.toFixed(2)}) — ${oneLine(it.verdict.reason)}`,
        );
      if (it.status === 'failed' || it.status === 'blocked') {
        const why = lastFailureReason(it) ?? it.evidence.at(-1)?.summary;
        if (why) lines.push(`${pad}  - 사유: ${oneLine(why)}`);
      }
      walk(it.id, depth + 1);
    }
  };
  walk(null, 0);
  lines.push('');
  return lines.join('\n');
}

// ── 29.6 HARNESS v2 CHECKPOINT.json ────────────────────────────
export const HARNESS_V2_FORMAT = 'harness-checkpoint';

const IsoDate = z.iso.datetime({ offset: true });

export const HarnessV2CheckpointSchema = z
  .object({
    format: z.literal(HARNESS_V2_FORMAT),
    version: z.literal(2),
    createdAt: IsoDate,
    sessionId: z.string().min(1),
    mission: z.object({ title: z.string().min(1), file: z.literal('MISSION.md') }).strict(),
    progress: z
      .object({
        revision: z.number().int().positive(),
        version: z.number().int().nonnegative(),
        total: z.number().int().nonnegative(),
        done: z.number().int().nonnegative(),
        remaining: z.number().int().nonnegative(),
      })
      .strict(),
    currentItemId: z.string().nullable(),
    /** 재개 시 엔진에게 줄 다음 행동 지시 (없으면 완료) */
    nextAction: z.string().nullable(),
    items: z.array(
      z
        .object({
          id: z.string().min(1),
          parent: z.string().nullable(),
          title: z.string(),
          status: z.enum(ITEM_STATUSES),
          attempts: z.number().int().nonnegative(),
          deps: z.array(z.string()),
          artifactId: z.string().min(1),
          /** manifest 정식 경로 (미확정이면 null) */
          path: z.string().nullable(),
          verdict: z
            .object({
              level: z.number().int().min(1).max(5),
              verdict: z.string(),
              confidence: z.number().min(0).max(1),
              reason: z.string(),
            })
            .strict()
            .nullable(),
          lastEvidence: z
            .object({ kind: z.string(), summary: z.string().nullable(), ts: z.string().nullable() })
            .strict()
            .nullable(),
        })
        .strict(),
    ),
    artifacts: z.record(
      z.string(),
      z.object({ displayName: z.string(), path: z.string(), kind: z.enum(['file', 'dir']) }).strict(),
    ),
  })
  .strict();
export type HarnessV2Checkpoint = z.infer<typeof HarnessV2CheckpointSchema>;

/** JSON Schema (schemas/harness-v2-checkpoint.schema.json과 같아야 한다) */
export function harnessV2CheckpointJsonSchema(): Record<string, unknown> {
  return {
    $id: 'https://harness-x.local/schemas/harness-v2-checkpoint.schema.json',
    title: 'HARNESS v2 CHECKPOINT.json',
    ...(z.toJSONSchema(HarnessV2CheckpointSchema) as Record<string, unknown>),
  };
}

export interface MissionInfo {
  title: string;
  /** 미션 설명(목표) */
  goal?: string;
  /** 제약·규칙 */
  constraints?: string[];
}

export interface CheckpointInput {
  sessionId: string;
  checklist: Checklist;
  manifest?: Manifest | null;
  mission: MissionInfo;
  now?: () => Date;
}

export function buildCheckpoint(i: CheckpointInput): HarnessV2Checkpoint {
  const c = i.checklist;
  const cur = currentItemOf(c);
  const rest = c.items.filter((x) => x.status !== 'done');
  const artifacts = Object.fromEntries(
    Object.entries(i.manifest?.artifacts ?? {}).map(([id, e]) => [
      id,
      { displayName: e.displayName, path: e.path, kind: e.kind },
    ]),
  );
  return HarnessV2CheckpointSchema.parse({
    format: HARNESS_V2_FORMAT,
    version: 2,
    createdAt: (i.now ?? (() => new Date()))().toISOString(),
    sessionId: i.sessionId,
    mission: { title: i.mission.title, file: 'MISSION.md' },
    progress: {
      revision: c.revision,
      version: c.version,
      total: c.items.length,
      done: c.items.length - rest.length,
      remaining: rest.length,
    },
    currentItemId: cur?.id ?? null,
    nextAction: cur ? nextInstruction(cur, rest.length) : null,
    items: c.items.map((it) => {
      const ev = it.evidence.at(-1);
      return {
        id: it.id,
        parent: it.parent,
        title: it.title,
        status: it.status,
        attempts: it.attempts,
        deps: it.deps,
        artifactId: it.artifactId,
        path: i.manifest?.artifacts[it.artifactId]?.path ?? null,
        verdict: it.verdict ?? null,
        lastEvidence: ev ? { kind: ev.kind, summary: ev.summary ?? null, ts: ev.ts ?? null } : null,
      };
    }),
    artifacts,
  });
}

export function renderMissionMarkdown(i: CheckpointInput): string {
  const c = i.checklist;
  const cur = currentItemOf(c);
  const done = c.items.filter((x) => x.status === 'done').length;
  const lines = [`# MISSION: ${i.mission.title}`, '', `세션: ${i.sessionId}`, ''];
  if (i.mission.goal) lines.push('## 목표', '', i.mission.goal.trim(), '');
  if (i.mission.constraints?.length)
    lines.push('## 제약', '', ...i.mission.constraints.map((x) => `- ${oneLine(x)}`), '');
  const arts = Object.entries(i.manifest?.artifacts ?? {});
  if (arts.length)
    lines.push(
      '## 산출물 (정식 경로)',
      '',
      ...arts.map(([id, e]) => `- ${e.displayName} (${id}) → \`${e.path}\``),
      '',
    );
  lines.push('## 진행', '', `${done}/${c.items.length} 완료`);
  lines.push(cur ? `다음: ${cur.id} ${oneLine(cur.title)}` : '모든 항목 완료', '');
  lines.push('상세 상태는 CHECKPOINT.json, 사람용 목록은 CHECKLIST.md를 본다.', '');
  return lines.join('\n');
}

/** CHECKLIST.md·CHECKPOINT.json·MISSION.md를 outDir에 쓴다 */
export function exportSession(
  outDir: string,
  i: CheckpointInput,
): { checklist: string; checkpoint: string; mission: string } {
  mkdirSync(outDir, { recursive: true });
  const files = {
    checklist: join(outDir, 'CHECKLIST.md'),
    checkpoint: join(outDir, 'CHECKPOINT.json'),
    mission: join(outDir, 'MISSION.md'),
  };
  writeFileAtomic(
    files.checklist,
    renderChecklistMarkdown(i.checklist, { title: i.mission.title, manifest: i.manifest }),
  );
  writeFileAtomic(files.checkpoint, JSON.stringify(buildCheckpoint(i), null, 2) + '\n');
  writeFileAtomic(files.mission, renderMissionMarkdown(i));
  return files;
}
