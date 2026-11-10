import {
  ChecklistLedger,
  ManifestStore,
  ensureProjectGlossary,
  loadDefaultGlossary,
} from '@harness-x/checklist-ledger';
import type { PluginContext } from '@harness-x/kernel';
import { installPlanGate } from './plan-gate.js';

/**
 * 하네스 플러그인 진입점. config:
 *   sessionDir (checklist.json·manifest.json 폴더, 필수), workspace, mode('strict'|'default'), glossaryFile
 * sessionDir가 없으면 게이트를 설치하지 않는다(어댑터가 installPlanGate를 직접 호출).
 */
let dispose: (() => void) | undefined;

export function activate(ctx: PluginContext): void {
  const c = ctx.config;
  const dir = typeof c.sessionDir === 'string' ? c.sessionDir : undefined;
  if (!dir) {
    ctx.log('permission-gate active (config.sessionDir 없음 — 게이트 미설치)');
    return;
  }
  const glossary =
    typeof c.glossaryFile === 'string' ? ensureProjectGlossary(c.glossaryFile) : loadDefaultGlossary();
  const sessionId = typeof c.sessionId === 'string' ? c.sessionId : 'kernel';
  const r = installPlanGate(ctx.hooks, {
    ledger: new ChecklistLedger({ dir, sessionId }),
    manifest: new ManifestStore({ dir }),
    glossary,
    ...(typeof c.workspace === 'string' ? { workspace: c.workspace } : {}),
    mode: c.mode === 'strict' ? 'strict' : 'default',
  });
  dispose = r.dispose;
  ctx.log(`permission-gate: plan gate installed (mode=${c.mode === 'strict' ? 'strict' : 'default'})`);
}

export function deactivate(): void {
  dispose?.();
  dispose = undefined;
}
