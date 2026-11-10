import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ChecklistLedger, type ChecklistItemInput } from '@harness-x/checklist-ledger';
import { EventLog, eventFactory } from '@harness-x/kernel';
import {
  parsePipeline,
  type EngineAdapter,
  type EngineRunOptions,
  type HarnessEvent,
  type PipelineInput,
} from '@harness-x/protocol';

export const RUNNER_FX = (n: string) => fileURLToPath(new URL(`./fixtures/runner/${n}`, import.meta.url));

export function tmpWorkspace() {
  const dir = mkdtempSync(join(tmpdir(), 'hx-runner-'));
  const log = new EventLog({ root: join(dir, 'logs') });
  return {
    dir,
    workspace: join(dir, 'ws'),
    log,
    cleanup: () => {
      log.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export const pipeline = (p: PipelineInput) => parsePipeline(p);

/** 체크리스트 항목 n개 (id = <prefix>1..n) */
export function items(prefix: string, n: number): ChecklistItemInput[] {
  return Array.from({ length: n }, (_, k) => ({
    id: `${prefix}${k + 1}`,
    title: `${prefix} 항목 ${k + 1} 하기`,
    artifactId: `art.${prefix}`,
    acceptance: [{ type: 'command', run: 'true' }],
  }));
}

/** 엔진이 MCP 도구로 하듯 원장 항목을 done까지 진행 (ids 없으면 남은 전부) */
export function completeItems(opts: EngineRunOptions, ids?: string[]) {
  const dir = opts.env?.HARNESS_X_CHECKLIST_DIR;
  if (!dir) return;
  const ledger = new ChecklistLedger({ dir, sessionId: opts.sessionId });
  const c = ledger.read();
  if (!c) return;
  for (const it of c.items) {
    if (it.status === 'done' || (ids && !ids.includes(it.id))) continue;
    if (it.status === 'todo' || it.status === 'failed') ledger.transition(it.id, 'doing');
    ledger.transition(it.id, 'verifying', { evidence: { kind: 'test', summary: 'ok' } });
    ledger.transition(it.id, 'done');
  }
}

export interface FakeTurn {
  text?: string;
  /** 추가 이벤트 바디 (tool_call 등) */
  events?: Record<string, unknown>[];
  /** 턴 중 부수효과 (원장 갱신 등) */
  effect?: (opts: EngineRunOptions) => void;
  delayMs?: number;
  reason?: 'completed' | 'error';
}

export interface FakeCall {
  engineId: string;
  node: string | undefined;
  prompt: string;
  resumeId?: string;
}

/** 프로세스 없는 가짜 엔진 (턴마다 script 호출) */
export function fakeEngine(
  id: string,
  script: (opts: EngineRunOptions, call: number) => FakeTurn,
  calls: FakeCall[] = [],
  opts: { nativeStopHook?: boolean } = {},
): EngineAdapter & { calls: FakeCall[] } {
  let n = 0;
  return {
    id,
    displayName: id,
    calls,
    capabilities: { nativeStopHook: opts.nativeStopHook ?? false, resume: true, mcp: true, interrupt: false },
    run(o: EngineRunOptions) {
      const k = n++;
      calls.push({
        engineId: id,
        node: o.env?.HARNESS_X_NODE,
        prompt: o.prompt,
        ...(o.resumeId ? { resumeId: o.resumeId } : {}),
      });
      const t = script(o, k);
      const ev = eventFactory({ sessionId: o.sessionId, engineId: id });
      const sid = `${id}-session-${k}`;
      let resolveDone!: (v: { exitCode: number | null }) => void;
      const done = new Promise<{ exitCode: number | null }>((r) => (resolveDone = r));
      async function* events(): AsyncGenerator<HarnessEvent> {
        if (t.delayMs) await new Promise((r) => setTimeout(r, t.delayMs));
        t.effect?.(o);
        for (const b of t.events ?? []) yield ev(b as never);
        if (t.text !== undefined) yield ev({ type: 'assistant_text', text: t.text, partial: false });
        yield ev({ type: 'turn_end', reason: t.reason ?? 'completed' });
        resolveDone({ exitCode: 0 });
      }
      return {
        events: events(),
        engineSessionId: () => sid,
        interrupt: async () => {},
        done,
      };
    },
  };
}
