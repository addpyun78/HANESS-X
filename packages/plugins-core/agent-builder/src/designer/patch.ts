import { z } from 'zod';
import { AgentDraftSchema, type AgentDraft } from '@harness-x/protocol';
import { jsonBlocks } from '../contract.js';
import type { Inventory } from '../inventory/schema.js';
import { findUnknownRefs } from './assets.js';
import { checkDraftEngines } from './engines.js';
import { draftPlainIssues } from './plain.js';
import { findCycleEdge } from './structure.js';

/**
 * P4-E.2 말로 고치기: 설계 AI는 초안 전체가 아니라 변경 패치(JSON Patch, RFC 6902 일부)만 돌려준다.
 * P4-E.3 패치 검증: 적용한 결과에 C.6(지어낸 자산)·C.7(엔진 사용 가능)·C.8(순환) 검사를 다시 하고,
 *        실패하면 적용하지 않고 쉬운 말 사유를 돌려준다.
 */

export const PATCH_PATH_RE =
  /^\/(nodes|edges|gaps|summary|displayName|name|command|estimatedCostHint)(\/(\d+|-|[A-Za-z0-9_~-]+))*$/;

export const PatchOpSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('add'), path: z.string().regex(PATCH_PATH_RE), value: z.unknown() }).strict(),
  z.object({ op: z.literal('replace'), path: z.string().regex(PATCH_PATH_RE), value: z.unknown() }).strict(),
  z.object({ op: z.literal('remove'), path: z.string().regex(PATCH_PATH_RE) }).strict(),
]);
export type PatchOp = z.infer<typeof PatchOpSchema>;
export const DraftPatchSchema = z.object({ patch: z.array(PatchOpSchema).min(1) }).strict();

export type PatchParse = { ok: true; patch: PatchOp[] } | { ok: false; errors: string[] };

/** 응답 텍스트 → 패치. {"patch":[...]} 객체만 받는다 (초안 전체를 돌려주면 거부) */
export function parsePatchReply(text: string | undefined): PatchParse {
  if (!text) return { ok: false, errors: ['응답이 비었습니다'] };
  const blocks = jsonBlocks(text);
  const raw = blocks[blocks.length - 1];
  if (!raw) return { ok: false, errors: ['JSON 객체를 찾지 못했습니다'] };
  const r = DraftPatchSchema.safeParse(raw);
  if (!r.success)
    return {
      ok: false,
      errors: r.error.issues.map(
        (i) => (i.path.length ? `${i.path.map(String).join('.')}: ` : '') + i.message,
      ),
    };
  for (const op of r.data.patch)
    if ((op.op === 'add' || op.op === 'replace') && op.value === undefined)
      return { ok: false, errors: [`${op.path}: value 필요`] };
  return { ok: true, patch: r.data.patch };
}

const unescape = (s: string) => s.replace(/~1/g, '/').replace(/~0/g, '~');

/** JSON Patch 적용 (원본은 그대로, 실패하면 throw) */
export function applyJsonPatch<T>(doc: T, patch: readonly PatchOp[]): T {
  const root = structuredClone(doc) as unknown as Record<string, unknown>;
  for (const op of patch) {
    const keys = op.path.split('/').slice(1).map(unescape);
    const last = keys.pop()!;
    let parent: unknown = root;
    for (const k of keys) {
      if (parent === null || typeof parent !== 'object') throw new Error(`경로 없음: ${op.path}`);
      parent = (parent as Record<string, unknown>)[k];
    }
    if (parent === null || typeof parent !== 'object') throw new Error(`경로 없음: ${op.path}`);
    if (Array.isArray(parent)) {
      const i = last === '-' ? parent.length : Number(last);
      if (!Number.isInteger(i) || i < 0 || i > parent.length || (op.op !== 'add' && i >= parent.length))
        throw new Error(`잘못된 위치: ${op.path}`);
      if (op.op === 'add') parent.splice(i, 0, structuredClone(op.value));
      else if (op.op === 'replace') parent[i] = structuredClone(op.value);
      else parent.splice(i, 1);
    } else {
      const obj = parent as Record<string, unknown>;
      if (op.op !== 'add' && !(last in obj)) throw new Error(`경로 없음: ${op.path}`);
      if (op.op === 'remove') delete obj[last];
      else obj[last] = structuredClone(op.value);
    }
  }
  return root as unknown as T;
}

export type PatchCheck = { ok: true; draft: AgentDraft } | { ok: false; reasons: string[] };

/** E.3 패치 적용 결과 검사 — 하나라도 걸리면 적용하지 않는다 (사유는 쉬운 말) */
export function checkPatchedDraft(cur: AgentDraft, patch: readonly PatchOp[], inv: Inventory): PatchCheck {
  let next: unknown;
  try {
    next = applyJsonPatch(cur, patch);
  } catch {
    return { ok: false, reasons: ['바꿀 곳을 초안에서 찾지 못했어요.'] };
  }
  const parsed = AgentDraftSchema.safeParse(next);
  if (!parsed.success) return { ok: false, reasons: ['바꾼 결과가 초안 형식에 맞지 않아요.'] };
  const d = parsed.data;
  const reasons: string[] = [];
  const unknown = findUnknownRefs(d, inv);
  if (unknown.length)
    reasons.push(`목록에 없는 것을 쓰려고 해요: ${[...new Set(unknown.map((u) => `"${u.id}"`))].join(', ')}`);
  for (const s of checkDraftEngines(d, inv)) reasons.push(s.message);
  if (findCycleEdge(d)) reasons.push('되돌아가는 연결이 생겨요. 반복은 반복 블록으로만 할 수 있어요.');
  if (draftPlainIssues(d).length) reasons.push('바뀐 설명이 어려운 말이라 그대로 보여 드릴 수 없어요.');
  return reasons.length ? { ok: false, reasons } : { ok: true, draft: d };
}
