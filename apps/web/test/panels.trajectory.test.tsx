// @vitest-environment jsdom
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventLog, type LogRecord } from '@harness-x/kernel';
import type { HarnessEvent } from '@harness-x/protocol';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { buildTrajectory, EMPTY_TRAJECTORY, reduceTrajectory } from '../src/panels/trajectory.js';
import { TrajectoryPanel } from '../src/panels/TrajectoryPanel.js';

afterEach(cleanup);

const S = 's-traj';
const ts = (n: number) => `2026-11-10T00:00:${String(n).padStart(2, '0')}.000Z`;
const ev = (n: number, body: Record<string, unknown>): HarnessEvent =>
  ({ id: `t${n}`, ts: ts(n), sessionId: S, engineId: 'codex', ...body }) as HarnessEvent;

const EVENTS: HarnessEvent[] = [
  ev(1, { type: 'assistant_text', text: '확인', partial: true }),
  ev(2, { type: 'assistant_text', text: '확인합니다', itemId: '1.1' }),
  ev(3, { type: 'tool_call', callId: 'c1', tool: 'Bash', input: { command: 'pnpm test' }, itemId: '1.1' }),
  ev(4, { type: 'tool_result', callId: 'c1', ok: true, output: 'ok', itemId: '1.1' }),
  ev(5, { type: 'usage', inputTokens: 1200, outputTokens: 300, cacheReadTokens: 100, costUsd: 0.012 }),
  ev(6, { type: 'turn_end', reason: 'completed' }),
  ev(7, { type: 'file_change', path: 'src/a.ts', change: 'modify', itemId: '1.2' }),
  ev(8, { type: 'usage', inputTokens: 800, outputTokens: 200, costUsd: 0.008 }),
  ev(9, { type: 'checklist_change', changedItemId: '1.2', from: 'doing', to: 'done', version: 3 }),
  ev(10, { type: 'turn_end', reason: 'completed' }),
];

describe('37.4 궤적 패널', () => {
  it('턴 단위 단계, 단계별·전체 토큰·비용 합산 (partial 텍스트 제외, 중복 id 무시)', () => {
    const t = buildTrajectory([...EVENTS, EVENTS[3]!]);
    expect(t.steps).toHaveLength(2);
    expect(t.steps[0]!.usage).toEqual({
      inputTokens: 1200,
      outputTokens: 300,
      cacheReadTokens: 100,
      costUsd: 0.012,
    });
    expect(t.steps[0]!.entries.map((e) => e.type)).toEqual([
      'assistant_text',
      'tool_call',
      'tool_result',
      'usage',
      'turn_end',
    ]);
    expect(t.steps[0]!.itemIds).toEqual(['1.1']);
    expect(t.steps[1]!.usage.inputTokens).toBe(800);
    expect(t.totals).toMatchObject({ inputTokens: 2000, outputTokens: 500, events: 9 });
    expect(t.totals.costUsd).toBeCloseTo(0.02);
  });

  it('리플레이 일치: 실시간 스트림(구독)으로 만든 궤적 = 이벤트 로그 재생으로 만든 궤적, 화면도 동일', async () => {
    const root = mkdtempSync(join(tmpdir(), 'hx-traj-'));
    const log = new EventLog({ root });
    let live = EMPTY_TRAJECTORY;
    const liveEvents: HarnessEvent[] = [];
    const off = log.subscribe((r: LogRecord) => {
      liveEvents.push(r as unknown as HarnessEvent);
      live = reduceTrajectory(live, r as unknown as HarnessEvent);
    });
    for (const e of EVENTS) log.append(e as unknown as LogRecord);
    off();
    const replayed: HarnessEvent[] = [];
    for await (const r of log.replay(S)) replayed.push(r as unknown as HarnessEvent);
    log.close();
    rmSync(root, { recursive: true, force: true });

    expect(buildTrajectory(replayed)).toStrictEqual(live);
    const a = render(<TrajectoryPanel events={liveEvents} />).container.innerHTML;
    cleanup();
    const b = render(<TrajectoryPanel events={replayed} />).container.innerHTML;
    expect(b).toBe(a);
    expect(screen.getByTestId('trajectory-totals').textContent).toBe(
      '2단계 · 이벤트 9개 · 입력 2,000 · 출력 500 · 캐시 100 · $0.0200',
    );
    expect(screen.getByLabelText('단계 1 사용량').textContent).toBe(
      '입력 1,200 · 출력 300 · 캐시 100 · $0.0120',
    );
  });

  it('이벤트 없으면 안내', () => {
    render(<TrajectoryPanel events={[]} />);
    expect(screen.getByText('아직 기록된 이벤트가 없습니다')).toBeTruthy();
  });
});
