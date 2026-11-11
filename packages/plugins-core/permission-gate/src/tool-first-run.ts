import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, posix, win32 } from 'node:path';
import type { BlockingHandler, HookResult } from '@harness-x/kernel';
import { SHELL_TOOLS } from './plan-gate.js';

/**
 * T-100 P2-F.6 새로 설치한 도구의 첫 실행은 한 번 묻는다.
 *  - 셸 도구 호출의 명령이 도구 목록(설치 관리자 registry)의 도구(이름 또는 절대 경로)를 실행하면
 *    아직 허락 기록이 없을 때 ask 콜백으로 묻는다.
 *  - 'always'(앞으로 허락)는 파일에 기억 → 다음부터 묻지 않는다. 'once'는 이번만 허락. 'deny'는 거부.
 */

export interface KnownTool {
  id: string;
  name: string;
  /** 절대 경로 (없으면 이름만으로 매칭) */
  command?: string;
}

export type FirstRunAnswer = 'always' | 'once' | 'deny';

export interface FirstRunAsk {
  toolId: string;
  toolName: string;
  command: string;
}

export interface ToolFirstRunOptions {
  /** 지금 도구 목록 (호출마다 평가 — 설치 직후 반영) */
  tools: () => KnownTool[];
  /** 기억 파일 (예: ~/.harness-x/tools/allowed.json) */
  file: string;
  ask?: (req: FirstRunAsk) => FirstRunAnswer | Promise<FirstRunAnswer>;
  shellTools?: readonly string[];
}

function commandOf(input: unknown): string {
  if (typeof input === 'string') return input;
  if (input && typeof input === 'object') {
    const a = input as Record<string, unknown>;
    for (const k of ['command', 'cmd', 'script'])
      if (typeof a[k] === 'string') return a[k];
      else if (Array.isArray(a[k])) return (a[k] as unknown[]).map(String).join(' ');
  }
  return '';
}

/** 명령 문자열에서 실행되는 프로그램들 (파이프·&&·; 로 이어진 각 단계의 첫 단어) */
export function invokedPrograms(command: string): string[] {
  const out: string[] = [];
  for (const seg of command.split(/\|\||&&|[|;\n]/)) {
    const m = /^\s*(?:[A-Za-z_]\w*=\S*\s+)*(?:"([^"]+)"|'([^']+)'|(\S+))/.exec(seg);
    const p = m?.[1] ?? m?.[2] ?? m?.[3];
    if (p) out.push(p);
  }
  return out;
}

const baseName = (p: string) => {
  const b = /[\\/]/.test(p) ? (p.includes('\\') ? win32.basename(p) : posix.basename(p)) : p;
  return b.replace(/\.(exe|cmd|bat)$/i, '').toLowerCase();
};

export function matchKnownTool(command: string, tools: KnownTool[]): KnownTool | undefined {
  for (const prog of invokedPrograms(command)) {
    const t = tools.find(
      (x) =>
        (x.command && (prog === x.command || prog.toLowerCase() === x.command.toLowerCase())) ||
        (x.command && baseName(prog) === baseName(x.command) && !/[\\/]/.test(prog)) ||
        baseName(prog) === x.name.toLowerCase(),
    );
    if (t) return t;
  }
  return undefined;
}

export class ToolFirstRunGate {
  private readonly allowed = new Set<string>();

  constructor(private readonly o: ToolFirstRunOptions) {
    if (existsSync(o.file))
      try {
        for (const id of (JSON.parse(readFileSync(o.file, 'utf8')) as { allowed?: string[] }).allowed ?? [])
          this.allowed.add(id);
      } catch {
        /* 깨진 파일 = 빈 목록 */
      }
  }

  isAllowed(toolId: string): boolean {
    return this.allowed.has(toolId);
  }

  remember(toolId: string): void {
    this.allowed.add(toolId);
    mkdirSync(dirname(this.o.file), { recursive: true });
    const tmp = `${this.o.file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ version: 1, allowed: [...this.allowed].sort() }, null, 2) + '\n');
    renameSync(tmp, this.o.file);
  }

  readonly handler: BlockingHandler = async (ctx): Promise<HookResult | void> => {
    const tool = typeof ctx.tool === 'string' ? ctx.tool : '';
    if (!(this.o.shellTools ?? SHELL_TOOLS).includes(tool)) return;
    const command = commandOf(ctx.input);
    if (!command) return;
    const known = matchKnownTool(command, this.o.tools());
    if (!known || this.allowed.has(known.id)) return;
    if (!this.o.ask)
      return {
        decision: 'deny',
        reason: `first_run_approval: 새로 설치한 도구 ${known.name}은(는) 처음 실행할 때 사용자 허락이 필요해요.`,
      };
    const answer = await this.o.ask({ toolId: known.id, toolName: known.name, command });
    if (answer === 'always') {
      this.remember(known.id);
      return;
    }
    if (answer === 'once') return;
    return { decision: 'deny', reason: `first_run_denied: 사용자가 ${known.name} 실행을 허락하지 않았어요.` };
  };
}

export const TOOL_FIRST_RUN_HOOK_ID = 'permission-gate:tool-first-run';

export function installToolFirstRunGate(
  hooks: { onBlocking(name: 'tool.before', h: BlockingHandler, o?: Record<string, unknown>): () => void },
  opts: ToolFirstRunOptions,
): { gate: ToolFirstRunGate; dispose: () => void } {
  const gate = new ToolFirstRunGate(opts);
  const dispose = hooks.onBlocking('tool.before', gate.handler, {
    id: TOOL_FIRST_RUN_HOOK_ID,
    priority: 20,
    failMode: 'deny',
    timeoutMs: opts.ask ? 10 * 60_000 : 10_000,
  });
  return { gate, dispose };
}
