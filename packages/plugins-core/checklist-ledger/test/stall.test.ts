import type { EngineAdapter, HarnessEvent } from '@harness-x/protocol';
import { describe, expect, it } from 'vitest';
import { ChecklistLedger } from '../src/ledger.js';
import { SessionBudget, StallDetector } from '../src/stall.js';
import { runWithStopGuard, StopGuard } from '../src/stop-guard.js';
import { item, tempDir } from './helpers.js';

function ev(body: Record<string, unknown>): HarnessEvent {
  return {
    id: Math.random().toString(36).slice(2),
    ts: new Date().toISOString(),
    sessionId: 's1',
    ...body,
  } as HarnessEvent;
}

/** 턴마다 work(turn)를 실행하고 usage + turn_end(completed)를 내는 가짜 엔진 */
function fakeEngine(
  work: (turn: number, prompt: string) => void,
  tokens = 10,
): EngineAdapter & { prompts: string[] } {
  const prompts: string[] = [];
  return {
    prompts,
    id: 'antigravity',
    displayName: 'fake',
    capabilities: { nativeStopHook: false, resume: false, mcp: false, interrupt: true },
    run(o) {
      prompts.push(o.prompt);
      work(prompts.length, o.prompt);
      const events = [
        ev({ type: 'usage', inputTokens: tokens, outputTokens: 0 }),
        ev({ type: 'turn_end', reason: 'completed' }),
      ];
      return {
        events: (async function* () {
          yield* events;
        })(),
        engineSessionId: () => undefined,
        interrupt: async () => {},
        done: Promise.resolve({ exitCode: 0 }),
      };
    },
  };
}

describe('29.3 정체 감지 (시뮬레이션)', () => {
  it('evidence 무변화 2턴 → 접근 변경 지시, 3턴 → blocked, 증거가 바뀌면 초기화', () => {
    const { dir, cleanup } = tempDir();
    try {
      const l = new ChecklistLedger({ dir, sessionId: 's1' });
      l.create([item('1'), item('2')]);
      const d = new StallDetector(l);
      d.beginTurn();
      expect(d.observeTurn()).toMatchObject({ action: 'none', itemId: '1', unchangedTurns: 1 });
      // 진척(증거 추가) → 초기화
      l.addEvidence('1', { kind: 'note', summary: '시도 1' });
      expect(d.observeTurn()).toMatchObject({ action: 'none', unchangedTurns: 0 });
      expect(d.observeTurn()).toMatchObject({ action: 'none', unchangedTurns: 1 });
      const two = d.observeTurn();
      expect(two).toMatchObject({ action: 'change_approach', itemId: '1', unchangedTurns: 2 });
      expect(two.action === 'change_approach' && two.instruction).toMatch(/접근을 바꾸세요/);
      expect(d.observeTurn()).toMatchObject({ action: 'blocked', itemId: '1', unchangedTurns: 3 });
      expect(l.item('1')).toMatchObject({ status: 'blocked' });
      expect(l.item('1').evidence.at(-1)).toMatchObject({ kind: 'stall_blocked' });
      // 다음 항목으로 넘어가 새로 센다
      expect(d.observeTurn()).toMatchObject({ action: 'none', itemId: '2', unchangedTurns: 0 });
    } finally {
      cleanup();
    }
  });

  it('runWithStopGuard: 일 안 하는 엔진 → 2턴째 접근 변경 지시가 프롬프트에, 3턴째 항목 blocked 후 다음 항목', async () => {
    const { dir, cleanup } = tempDir();
    try {
      const l = new ChecklistLedger({ dir, sessionId: 's1' });
      l.create([item('1'), item('2')]);
      let done2 = false;
      const engine = fakeEngine((turn, prompt) => {
        // 항목 2가 지시되면 그건 끝낸다
        if (!done2 && /다음 항목 2:/.test(prompt) && !/다음 항목 1:/.test(prompt)) {
          l.transition('2', 'doing');
          l.transition('2', 'verifying');
          l.transition('2', 'done');
          done2 = true;
        }
        void turn;
      });
      for await (const e of runWithStopGuard({
        engine,
        run: { sessionId: 's1', prompt: '시작', cwd: dir },
        guard: new StopGuard(l),
        stall: new StallDetector(l),
        maxAutoTurns: 10,
      }))
        void e;
      // 1턴(무변화1) → 2턴(무변화2, 접근 변경 지시는 3턴 프롬프트) → 3턴(무변화3 → blocked) → 4턴 항목 2 → 완료
      expect(engine.prompts[2]).toMatch(/^항목 1이\(가\) 2턴 동안 진척\(새 증거\)이 없습니다/);
      expect(l.item('1').status).toBe('blocked');
      expect(l.item('2').status).toBe('done');
      expect(engine.prompts).toHaveLength(4);
      expect(engine.prompts[3]).toMatch(/^다음 항목 2:/);
    } finally {
      cleanup();
    }
  });
});

describe('29.4 세션 상한 → 일시정지', () => {
  const cases = [
    ['iterations', { maxIterations: 2 }, 2],
    ['tokens', { maxTokens: 25 }, 3],
    ['time', { maxDurationMs: 1000 }, 2],
  ] as const;

  it.each(cases)('%s 상한', async (limit, limits, expectedTurns) => {
    const { dir, cleanup } = tempDir();
    try {
      const l = new ChecklistLedger({ dir, sessionId: 's1' });
      l.create([item('1')]);
      let clock = 0;
      const budget = new SessionBudget({ ...limits }, () => clock);
      // 매 턴 증거를 남겨 정체·무진척으로 끝나지 않게 한다 (상한만 멈출 수 있게)
      const engine = fakeEngine((turn) => {
        l.addEvidence('1', { kind: 'note', summary: `t${turn}` });
        clock += 600;
      });
      const events: HarnessEvent[] = [];
      for await (const e of runWithStopGuard({
        engine,
        run: { sessionId: 's1', prompt: '시작', cwd: dir },
        guard: new StopGuard(l),
        stall: new StallDetector(l),
        budget,
        maxAutoTurns: 50,
      }))
        events.push(e);
      expect(engine.prompts).toHaveLength(expectedTurns);
      expect(budget.paused).toBe(true);
      const c = budget.check();
      expect(c.paused && c.limit).toBe(limit);
      expect(events.at(-2)).toMatchObject({ type: 'error', code: 'session_limit' });
      expect(events.at(-1)).toMatchObject({ type: 'turn_end', reason: 'max_turns' });
      // 상한을 올리고 재개하면 다시 진행 가능
      budget.resume({ maxIterations: 100, maxTokens: 10_000, maxDurationMs: 1e9 });
      expect(budget.check()).toEqual({ paused: false });
    } finally {
      cleanup();
    }
  });
});
