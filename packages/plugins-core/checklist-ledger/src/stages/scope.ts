import type { HookBus, HookResult } from '@harness-x/kernel';
import type { Manifest } from '../manifest.js';
import type { Stage, StageTree } from './schema.js';
import { allStages, getStage } from './tree.js';

/**
 * 단계 산출물 범위 (T-101 4B.4)
 *  - 노드의 `artifacts`: 이 단계가 쓸 수 있는 경로 패턴 (`*` 한 조각, `**` 여러 조각, `?` 한 글자)
 *  - 다른 단계 산출물 수정은 그 노드 id가 `canModify`에 있을 때만
 *  - 단계별 manifest 구획: 정식 경로를 단계 범위로 나눈다
 */

const reCache = new Map<string, RegExp>();

/** 경로 패턴 → 정규식 */
export function globToRegExp(glob: string): RegExp {
  const hit = reCache.get(glob);
  if (hit) return hit;
  let re = '';
  const g = glob.replace(/\\/g, '/').replace(/^\.\//, '');
  for (let k = 0; k < g.length; k++) {
    const c = g[k]!;
    if (c === '*') {
      if (g[k + 1] === '*') {
        k++;
        if (g[k + 1] === '/') {
          k++;
          re += '(?:.*/)?';
        } else re += '.*';
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  const out = new RegExp(`^${re}$`);
  reCache.set(glob, out);
  return out;
}

export function normPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/');
}

export function matchesAny(path: string, patterns: readonly string[]): boolean {
  const p = normPath(path);
  return patterns.some((g) => globToRegExp(g).test(p) || globToRegExp(`${g.replace(/\/$/, '')}/**`).test(p));
}

export type WriteCheck =
  { allowed: true; owner?: string } | { allowed: false; reason: string; owner?: string };

/** 단계가 path에 써도 되는가 */
export function checkStageWrite(t: Pick<StageTree, 'stages'>, stageId: string, path: string): WriteCheck {
  const s = getStage(t, stageId);
  const others = allStages(t).filter(
    (o) => o.stageId !== stageId && o.nodeId && o.nodeId !== s.nodeId && o.scope.artifacts.length,
  );
  const owner = others.find((o) => matchesAny(path, o.scope.artifacts));
  const mine = s.scope.artifacts.length > 0 && matchesAny(path, s.scope.artifacts);
  if (mine) return { allowed: true };
  if (owner) {
    if (owner.nodeId && s.scope.canModify.includes(owner.nodeId))
      return { allowed: true, owner: owner.stageId };
    return {
      allowed: false,
      owner: owner.stageId,
      reason: `${normPath(path)}은(는) ${owner.title} 단계가 만든 파일이라 이 단계에서는 고칠 수 없어요.`,
    };
  }
  if (s.scope.artifacts.length)
    return { allowed: false, reason: `${normPath(path)}은(는) ${s.title} 단계가 맡은 파일이 아니에요.` };
  return { allowed: true };
}

/** 제안 항목이 단계 범위 안인가 (4B.3 자동 확정 조건) — manifest 정식 경로 기준 */
export function itemsInScope(
  t: Pick<StageTree, 'stages'>,
  stageId: string,
  artifactIds: readonly string[],
  manifest: Pick<Manifest, 'artifacts'> | null | undefined,
): boolean {
  for (const id of artifactIds) {
    const path = manifest?.artifacts[id]?.path;
    if (!path) continue; // 아직 정해지지 않은 경로는 잠글 때 정한다
    if (!checkStageWrite(t, stageId, path).allowed) return false;
  }
  return true;
}

/** 단계별 manifest 구획: 단계 id → 그 단계 범위에 드는 산출물 id (어느 단계에도 안 들면 '_shared') */
export function manifestSections(
  t: Pick<StageTree, 'stages'>,
  manifest: Pick<Manifest, 'artifacts'>,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const stages = allStages(t).filter((s: Stage) => s.scope.artifacts.length);
  for (const [id, e] of Object.entries(manifest.artifacts)) {
    const owner = stages.find((s) => matchesAny(e.path, s.scope.artifacts));
    const key = owner?.stageId ?? '_shared';
    (out[key] ??= []).push(id);
  }
  return out;
}

/** 도구 호출 입력에서 쓰기 경로 찾기 (Write·Edit·apply_patch 류) */
export function writePathsOf(tool: string, input: unknown): string[] {
  if (!/write|edit|patch|create|move|rename|delete/i.test(tool)) return [];
  const o = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  return ['file_path', 'path', 'filePath', 'target', 'destination']
    .map((k) => o[k])
    .filter((v): v is string => typeof v === 'string' && v.length > 0);
}

/**
 * 범위 밖 쓰기 차단 훅 (tool.before 차단형). current()가 지금 단계를 돌려주면 그 단계 범위로 검사한다.
 * toRelative: 절대 경로 → 작업 폴더 기준 상대 경로
 */
export function installStageScopeGuard(
  hooks: HookBus,
  current: () => { tree: Pick<StageTree, 'stages'>; stageId: string } | null,
  o: { toRelative?: (p: string) => string; pluginId?: string } = {},
): () => void {
  return hooks.onBlocking(
    'tool.before',
    (ctx): HookResult => {
      const cur = current();
      if (!cur) return { decision: 'allow' };
      for (const p of writePathsOf(String(ctx.tool ?? ''), ctx.input)) {
        const r = checkStageWrite(cur.tree, cur.stageId, o.toRelative ? o.toRelative(p) : p);
        if (!r.allowed) return { decision: 'block', reason: r.reason };
      }
      return { decision: 'allow' };
    },
    { id: 'checklist-ledger:stage-scope', ...(o.pluginId ? { pluginId: o.pluginId } : {}) },
  );
}
