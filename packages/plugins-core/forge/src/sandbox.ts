import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { compareValues, defaultCompareCtx } from '@harness-x/comparators';
import { HookBus, PluginLoader, TrustStore, type HookName } from '@harness-x/kernel';
import { compilePlugin, runChecks, type CompileResult } from './check.js';
import type { ForgeExample, ForgeSpec } from './spec.js';
import type { ForgeSessionState, GateOutcome } from './engine.js';

/**
 * T-052 52.3 샌드박스 시험
 * 플러그인을 빌드(dist/)한 뒤, spec 예시마다 새 임시 워크스페이스(예시 files를 깐 곳)에서
 * 격리 로더(unsigned-isolated → worker_threads, 권한 프록시)로 활성화하고 예시 입력을 넣어 acceptance를 확인한다.
 * - hook: spec.trigger.hook을 예시 input(훅 컨텍스트)으로 실행, expect.decision / reasonContains 비교
 * - 그 밖의 종류: 격리 환경에서 활성화되면 통과
 * 실패하면 gate가 scaffold로 되돌린다(최대 3회 — pipelines/forge.yaml maxRetries).
 */

export interface ExampleResult {
  name: string;
  ok: boolean;
  expected: ForgeExample['expect'];
  actual?: { decision: string; reason?: string };
  error?: string;
}

export interface SandboxReport {
  ok: boolean;
  build: CompileResult;
  results: ExampleResult[];
  /** 실패 사유 (사람이 읽는 문장, scaffold 재작성 지시에 들어간다) */
  reasons: string[];
}

export interface SandboxOptions {
  /** 활성화·훅 제한 시간 (기본 20초 / 훅 10초) */
  lifecycleTimeoutMs?: number;
  hookTimeoutMs?: number;
  logger?: (line: string) => void;
}

const COPY_SKIP = new Set(['node_modules', '.git']);

/** 플러그인 폴더를 복사 (node_modules·.git 제외) */
export function copyPlugin(src: string, dest: string): void {
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(src, dest, { recursive: true, filter: (p) => !COPY_SKIP.has(basename(p)) });
}

async function runExample(
  dir: string,
  spec: ForgeSpec,
  ex: ForgeExample,
  opts: SandboxOptions,
): Promise<ExampleResult> {
  const tmp = mkdtempSync(join(tmpdir(), 'hx-forge-sandbox-'));
  const ws = join(tmp, 'ws');
  const root = join(tmp, 'plugins');
  const lines: string[] = [];
  const fail = (error: string): ExampleResult => ({ name: ex.name, ok: false, expected: ex.expect, error });
  let loader: PluginLoader | undefined;
  try {
    mkdirSync(ws, { recursive: true });
    for (const [rel, content] of Object.entries(ex.files)) {
      const f = join(ws, rel);
      mkdirSync(dirname(f), { recursive: true });
      writeFileSync(f, content, { mode: 0o755 });
    }
    copyPlugin(dir, join(root, spec.id));
    const hooks = new HookBus({ timeoutMs: opts.hookTimeoutMs ?? 10_000, defaultSessionId: 'forge-sandbox' });
    loader = new PluginLoader({
      hooks,
      roots: [{ dir: root, origin: 'user' }],
      lockFile: join(tmp, 'plugins.lock'),
      sandbox: { trust: new TrustStore(), workspace: ws },
      lifecycleTimeoutMs: opts.lifecycleTimeoutMs ?? 20_000,
      logger: (l) => {
        lines.push(l);
        opts.logger?.(l);
      },
    });
    await loader.loadAll();
    const p = loader.plugins.get(spec.id);
    if (!p) {
      const why = loader.rejections.map((r) => r.reason).join('; ');
      return fail(`플러그인이 로드되지 않음: ${why || '이유 모름'}`);
    }
    if (p.state !== 'active') return fail(`격리 활성화 실패: ${p.error ?? p.state}`);
    if (spec.kind !== 'hook') return { name: ex.name, ok: true, expected: ex.expect };
    const hook = spec.trigger.hook as HookName;
    const ctx = { sessionId: 'forge-sandbox', cwd: ws, ...ex.input };
    if (ex.expect.decision === undefined) {
      await hooks.emit(hook, ctx);
      return { name: ex.name, ok: true, expected: ex.expect };
    }
    const out = await hooks.runBlocking(hook, ctx);
    const actual = { decision: out.decision, ...(out.reason ? { reason: out.reason } : {}) };
    const problems: string[] = [];
    const cc = defaultCompareCtx({ workspaceRoot: ws });
    if (compareValues('exact', ex.expect.decision, out.decision, cc).next !== 'pass')
      problems.push(
        `결정 ${out.decision} (기대 ${ex.expect.decision})${out.reason ? ` 사유: ${out.reason}` : ''}`,
      );
    const reasonOk = (want: string) =>
      compareValues('text', want, out.reason ?? '', cc, { options: { mode: 'contains' }, semantic: 'off' })
        .next === 'pass';
    if (ex.expect.reasonContains && !reasonOk(ex.expect.reasonContains))
      problems.push(`사유에 '${ex.expect.reasonContains}' 없음`);
    return {
      name: ex.name,
      ok: problems.length === 0,
      expected: ex.expect,
      actual,
      ...(problems.length ? { error: problems.join('; ') } : {}),
    };
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  } finally {
    if (loader)
      for (const id of [...loader.plugins.keys()])
        await loader.deactivate(id, { force: true }).catch(() => {});
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** 빌드 → 예시마다 격리 실행 */
export async function runSandbox(
  dir: string,
  spec: ForgeSpec,
  opts: SandboxOptions = {},
): Promise<SandboxReport> {
  const build = compilePlugin(dir, { emit: true });
  if (!build.ok)
    return { ok: false, build, results: [], reasons: build.errors.map((e) => `빌드 실패: ${e.message}`) };
  const results: ExampleResult[] = [];
  for (const ex of spec.examples) results.push(await runExample(dir, spec, ex, opts));
  const reasons = results.filter((r) => !r.ok).map((r) => `예시 '${r.name}' 실패: ${r.error ?? ''}`);
  return { ok: reasons.length === 0, build, results, reasons };
}

// ── gate 판정 (Forge check / test) ──────────────────────────
/** check gate: 정적 검사 (제안은 실패가 아니다) */
export function checkGate(state: ForgeSessionState): GateOutcome {
  const r = runChecks(state.pluginDir, state.spec);
  return {
    ok: r.ok,
    reasons: r.errors.map((e) => `[${e.kind}] ${e.message}`),
    detail: {
      errors: r.errors,
      suggestions: r.suggestions,
      ...(r.minimized ? { minimized: r.minimized } : {}),
    },
  };
}

/** test gate: 정적 검사(재작성 뒤에도 깨지지 않았는지) + 샌드박스 시험 */
export async function testGate(state: ForgeSessionState, opts: SandboxOptions = {}): Promise<GateOutcome> {
  if (!state.spec) return { ok: false, reasons: ['spec 없음'] };
  const c = checkGate(state);
  if (!c.ok) return c;
  const r = await runSandbox(state.pluginDir, state.spec, opts);
  return { ok: r.ok, reasons: r.reasons, detail: { results: r.results } };
}
