import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ChecklistLedger,
  runWithStopGuard,
  StopGuard,
  type ChecklistItemInput,
} from '@harness-x/checklist-ledger';
import { createAntigravityEngine } from '@harness-x/engine-antigravity';
import { EventLog, HookBus, runAgentLoop, toEngineRun, type ModelClient } from '@harness-x/kernel';
import type { EngineAdapter, HarnessEvent } from '@harness-x/protocol';
import { describe, expect, it } from 'vitest';

/** 28.5 무훅 엔진(agy·로컬): turn_end 뒤 하네스가 판단하고 다음 턴을 자동 전송 — 리플레이로 2턴 자동 진행 */
const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const AGY_FX = join(root, 'packages/engines/antigravity/test/fixtures');

const item = (id: string): ChecklistItemInput => ({
  id,
  title: `항목 ${id} 구현`,
  artifactId: `art.item-${id}`,
  acceptance: [{ type: 'test', run: `pnpm test item-${id}` }],
});

function finishCurrent(l: ChecklistLedger) {
  const cur = l.currentItem();
  if (!cur) return;
  l.transition(cur.id, 'doing');
  l.transition(cur.id, 'verifying');
  l.transition(cur.id, 'done');
}

/** 실제 엔진을 감싸 턴마다 "작업"(현재 항목 완료)을 흉내 내고 받은 프롬프트를 기록 */
function working(engine: EngineAdapter, ledger: ChecklistLedger, prompts: string[]): EngineAdapter {
  return {
    ...engine,
    run(o) {
      prompts.push(o.prompt);
      finishCurrent(ledger);
      return engine.run(o);
    },
  };
}

function env() {
  const dir = mkdtempSync(join(tmpdir(), 'hx-reinject-'));
  const log = new EventLog({ root: join(dir, 'logs') });
  const hooks = new HookBus({ log });
  const ledger = new ChecklistLedger({ dir: join(dir, 'session'), sessionId: 's1' });
  ledger.create([item('1'), item('2')]);
  const guard = new StopGuard(ledger);
  guard.install(hooks);
  return {
    dir,
    log,
    hooks,
    ledger,
    guard,
    cleanup: () => {
      log.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

async function collect(it: AsyncIterable<HarnessEvent>): Promise<HarnessEvent[]> {
  const out: HarnessEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

function expectTwoTurns(
  events: HarnessEvent[],
  prompts: string[],
  t: ReturnType<typeof env>,
  engineId: string,
) {
  expect(prompts).toHaveLength(2);
  expect(prompts[0]).toBe('시작');
  expect(prompts[1]).toMatch(/^다음 항목 2: 항목 2 구현/);
  const ends = events.filter((e) => e.type === 'turn_end');
  expect(ends.map((e) => (e.type === 'turn_end' ? e.reason : ''))).toEqual([
    'completed',
    'blocked',
    'completed',
  ]);
  expect(ends[1]).toMatchObject({ engineId, reason: 'blocked', remaining: 1, nextItemId: '2' });
  expect(t.ledger.remaining()).toHaveLength(0);
  const hr = t.log.query({ sessionId: 's1', type: 'hook_result' });
  expect(hr.map((r) => [r.hook, r.decision])).toEqual([
    ['stop.before', 'block'],
    ['stop.before', 'allow'],
  ]);
}

describe('28.5 하네스 재주입 (nativeStopHook: false)', () => {
  it('antigravity(가짜 agy 리플레이): 1턴 뒤 차단 → 다음 항목 지시로 2턴 자동 → 완료 후 종료', async () => {
    const t = env();
    try {
      const prompts: string[] = [];
      const agy = createAntigravityEngine({
        command: process.execPath,
        prefixArgs: [join(AGY_FX, 'fake-agy.mjs')],
      });
      const argvLog = join(t.dir, 'argv.jsonl');
      const events = await collect(
        runWithStopGuard({
          engine: working(agy, t.ledger, prompts),
          run: {
            sessionId: 's1',
            prompt: '시작',
            cwd: t.dir,
            env: { ...process.env, HX_FAKE_LOG: argvLog, HX_FAKE_STDOUT: join(AGY_FX, 'hi.real.jsonl') },
          },
          guard: t.guard,
          hooks: t.hooks,
        }),
      );
      expectTwoTurns(events, prompts, t, 'antigravity');
      // 가짜 agy가 실제로 두 번 실행됐고 두 번째 -p가 다음 항목 지시문
      const argv = readFileSync(argvLog, 'utf8')
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l) as string[]);
      expect(argv).toHaveLength(2);
      expect(argv[1]!.at(-1)).toMatch(/^다음 항목 2:/);
    } finally {
      t.cleanup();
    }
  });

  it('로컬 LLM(하네스 도구 루프, 녹화 응답): 같은 판단으로 2턴 자동', async () => {
    const t = env();
    try {
      const prompts: string[] = [];
      const client: ModelClient = { complete: async () => ({ text: '완료했습니다', toolCalls: [] }) };
      const local: EngineAdapter = {
        id: 'openai-compat:ollama',
        displayName: 'Ollama',
        capabilities: { nativeStopHook: false, resume: false, mcp: false, interrupt: true },
        run: (o) =>
          toEngineRun(
            (signal) =>
              runAgentLoop({
                client,
                sessionId: o.sessionId,
                cwd: o.cwd,
                prompt: o.prompt,
                engineId: 'openai-compat:ollama',
                signal,
              }),
            {},
          ),
      };
      const events = await collect(
        runWithStopGuard({
          engine: working(local, t.ledger, prompts),
          run: { sessionId: 's1', prompt: '시작', cwd: t.dir },
          guard: t.guard,
          hooks: t.hooks,
        }),
      );
      expectTwoTurns(events, prompts, t, 'openai-compat:ollama');
    } finally {
      t.cleanup();
    }
  });

  it('무진척이면 한 번 차단 뒤 사람에게 넘긴다 (무한 루프 없음)', async () => {
    const t = env();
    try {
      let runs = 0;
      const idle: EngineAdapter = {
        id: 'antigravity',
        displayName: 'idle',
        capabilities: { nativeStopHook: false, resume: false, mcp: false, interrupt: true },
        run: (o) => {
          runs++;
          return toEngineRun(async function* () {
            yield {
              id: `e${runs}`,
              ts: new Date().toISOString(),
              sessionId: o.sessionId,
              type: 'turn_end',
              reason: 'completed',
            } satisfies HarnessEvent;
          });
        },
      };
      await collect(
        runWithStopGuard({
          engine: idle,
          run: { sessionId: 's1', prompt: 'x', cwd: t.dir },
          guard: t.guard,
          hooks: t.hooks,
        }),
      );
      expect(runs).toBe(2);
    } finally {
      t.cleanup();
    }
  });
});
