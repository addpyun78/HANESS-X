import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import type { Acceptance } from '@harness-x/checklist-ledger';
import {
  compareValues,
  defaultCompareCtx,
  textComparator,
  type CompareCtx,
  type CompareOutcome,
} from '@harness-x/comparators';

/**
 * 판정 사다리 L3 — 내용 증거 (25.4)
 * 항목의 acceptance(테스트·명령·심볼·파일·스키마)를 후보 경로에서 다시 실행한다.
 * command/test의 run 안 {path}·{rel}은 후보의 절대·상대 경로로 치환된다.
 * llm 조건은 코드 판정 대상이 아니므로 건너뛴다(skipped).
 */

export interface AcceptanceContext {
  /** 후보 산출물의 절대 경로 */
  artifactPath: string;
  /** 작업 폴더 루트 (명령 cwd) */
  root: string;
  kind: 'file' | 'dir';
}

export interface AcceptanceOutcome {
  type: Acceptance['type'];
  ok: boolean;
  skipped?: boolean;
  detail: string;
  /** 비교기 결과 (T-100 D.6: 종료코드·기대 출력 비교) */
  compare?: CompareOutcome;
}

/** 비교기 ctx (판정 사다리 밖 사전은 비어 있다) */
function compareCtx(ctx: AcceptanceContext): CompareCtx {
  return defaultCompareCtx({ workspaceRoot: ctx.root });
}

export type AcceptanceRunner = (acc: Acceptance, ctx: AcceptanceContext) => Promise<AcceptanceOutcome>;

export interface ContentEvidence {
  /** 기계 검증 조건이 1개 이상 있고 모두 통과 */
  ok: boolean;
  outcomes: AcceptanceOutcome[];
}

const MAX_SCAN_FILES = 2000;
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.gradle']);

function* walk(dir: string, budget = { n: MAX_SCAN_FILES }): Generator<string> {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries.sort()) {
    if (budget.n <= 0) return;
    const p = join(dir, name);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (!SKIP_DIRS.has(name)) yield* walk(p, budget);
    } else if (st.isFile()) {
      budget.n--;
      yield p;
    }
  }
}

function target(ctx: AcceptanceContext, file?: string): string {
  return file ? join(ctx.artifactPath, file) : ctx.artifactPath;
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function runShell(
  cmd: string,
  cwd: string,
  timeoutMs: number,
): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, { cwd, shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const keep = (b: Buffer) => {
      out = (out + b.toString('utf8')).slice(-2000);
    };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: null, out: String(err) });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, out });
    });
  });
}

/** 기본 실행기: 파일 시스템 검사 + 셸 명령 */
export const defaultAcceptanceRunner: AcceptanceRunner = async (acc, ctx) => {
  switch (acc.type) {
    case 'file_exists': {
      const p = target(ctx, acc.file);
      const ok = existsSync(p);
      return { type: acc.type, ok, detail: `${ok ? '있음' : '없음'}: ${relative(ctx.root, p) || '.'}` };
    }
    case 'symbol': {
      const p = target(ctx, acc.file);
      if (!existsSync(p)) return { type: acc.type, ok: false, detail: `없음: ${relative(ctx.root, p)}` };
      const files = statSync(p).isDirectory() ? walk(p) : [p];
      for (const f of files) {
        let text: string;
        try {
          text = readFileSync(f, 'utf8');
        } catch {
          continue;
        }
        const found = textComparator.equals(acc.symbol, text, compareCtx(ctx), {
          ...acc.compare?.options,
          mode: 'contains',
        });
        if (found.verdict === 'equal')
          return { type: acc.type, ok: true, detail: `${acc.symbol} @ ${relative(ctx.root, f)}` };
      }
      return { type: acc.type, ok: false, detail: `${acc.symbol} 없음` };
    }
    case 'schema': {
      const p = target(ctx, acc.file);
      try {
        const v = JSON.parse(readFileSync(p, 'utf8')) as unknown;
        if (typeof v !== 'object' || v === null)
          return { type: acc.type, ok: false, detail: 'JSON 객체 아님' };
        const missing = acc.requiredKeys.filter((k) => !(k in v));
        return {
          type: acc.type,
          ok: missing.length === 0,
          detail: missing.length ? `키 없음: ${missing.join(', ')}` : 'JSON 키 확인',
        };
      } catch (err) {
        return { type: acc.type, ok: false, detail: `JSON 읽기 실패: ${(err as Error).message}` };
      }
    }
    case 'command':
    case 'test': {
      const rel = relative(ctx.root, ctx.artifactPath).split('\\').join('/') || '.';
      const cmd = acc.run
        .replaceAll('{path}', shellQuote(ctx.artifactPath))
        .replaceAll('{rel}', shellQuote(rel));
      const { code, out } = await runShell(cmd, ctx.root, acc.timeoutMs ?? 120_000);
      const cc = compareCtx(ctx);
      const exit = compareValues('exitCode', acc.expectExit, code ?? 'killed', cc, { semantic: 'off' });
      const output =
        acc.expectOutput !== undefined
          ? compareValues(acc.compare?.kind ?? 'auto', acc.expectOutput, out, cc, {
              ...(acc.compare?.options ? { options: acc.compare.options } : {}),
              ...(acc.compare?.semantic ? { semantic: acc.compare.semantic } : {}),
            })
          : undefined;
      const tail = out.trim() ? ` — ${out.trim().split('\n').slice(-3).join(' | ')}` : '';
      return {
        type: acc.type,
        ok: exit.next === 'pass' && (output === undefined || output.next === 'pass'),
        detail: `exit ${code ?? 'killed'}${output ? ` · 출력 ${output.kind} ${output.verdict}` : ''}${tail}`,
        compare: output ?? exit,
      };
    }
    case 'llm':
      return { type: acc.type, ok: false, skipped: true, detail: 'llm 조건은 코드 판정에서 건너뜀' };
  }
};

/** 후보 경로에서 acceptance 전부 실행 */
export async function checkContentEvidence(
  acceptance: readonly Acceptance[],
  ctx: AcceptanceContext,
  runner: AcceptanceRunner = defaultAcceptanceRunner,
): Promise<ContentEvidence> {
  const abs = isAbsolute(ctx.artifactPath) ? ctx.artifactPath : join(ctx.root, ctx.artifactPath);
  const c = { ...ctx, artifactPath: abs };
  const outcomes: AcceptanceOutcome[] = [];
  for (const acc of acceptance) outcomes.push(await runner(acc, c));
  const machine = outcomes.filter((o) => !o.skipped);
  return { ok: machine.length > 0 && machine.every((o) => o.ok), outcomes };
}
