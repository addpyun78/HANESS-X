import { join } from 'node:path';
import { ChecklistLedger } from '@harness-x/checklist-ledger';
import { describe, expect, it } from 'vitest';
import { EventLog, type LogRecord } from '../src/event-log.js';
import { runChecklistWithFailover, type FailoverRunInput, type FailoverRunResult } from '../src/quota.js';
import { tempDir } from './helpers.js';

const S = 's-resume';
const item = (id: string) => ({
  id,
  title: `항목 ${id}`,
  artifactId: `art.item-${id.replace(/\./g, '-')}`,
  acceptance: [{ type: 'test' as const, run: `pnpm test item-${id}` }],
});

describe('60.4 엔진이 바뀌어도 "다음 미완료 항목"부터 재개 (리플레이)', () => {
  it('claude-code가 1.2 도중 한도 → codex가 1.2부터 이어서 → 1.3; 이벤트 로그 재생으로 확인', async () => {
    const t = tempDir('hx-resume-');
    const log = new EventLog({ root: join(t.dir, 'logs') });
    const ledger = new ChecklistLedger({ dir: join(t.dir, 'ws'), sessionId: S, log });
    ledger.create([item('1.1'), item('1.2'), item('1.3')]);

    let seq = 0;
    const emit = (body: Record<string, unknown>) =>
      log.append({
        id: `r${++seq}`,
        ts: new Date(Date.UTC(2026, 10, 10, 1, 0, 0, seq)).toISOString(),
        sessionId: S,
        ...body,
      } as LogRecord);
    let claudeBudget = 1;
    const prompts: string[] = [];

    const runItem = async ({ selection, item: it, prompt }: FailoverRunInput): Promise<FailoverRunResult> => {
      prompts.push(`${selection.engineId}|${prompt}`);
      const engineId = selection.engineId;
      if (ledger.item(it.id).status === 'todo') ledger.transition(it.id, 'doing');
      emit({ type: 'assistant_text', text: `${it.id} 작업`, engineId, itemId: it.id });
      if (engineId === 'claude-code' && claudeBudget-- <= 0) {
        emit({ type: 'error', code: 'quota_exceeded', message: 'usage limit', engineId, itemId: it.id });
        emit({ type: 'turn_end', reason: 'error', engineId, itemId: it.id });
        return { status: 'quota_exceeded' };
      }
      emit({ type: 'usage', inputTokens: 10, outputTokens: 5, engineId, itemId: it.id });
      ledger.transition(it.id, 'verifying');
      ledger.transition(it.id, 'done');
      emit({ type: 'turn_end', reason: 'completed', engineId, itemId: it.id });
      return { status: 'done' };
    };

    const r = await runChecklistWithFailover({
      ledger,
      start: { engineId: 'claude-code', mode: 'subscription' },
      route: {
        settings: {
          engines: {
            'claude-code': { mode: 'subscription', fallback: ['codex'] },
            codex: { mode: 'subscription', fallback: [] },
          },
        },
        hasApiKey: () => false,
      },
      runItem,
      sleepUntil: async () => {},
    });
    expect(r.status).toBe('completed');
    expect(r.runs.map((x) => `${x.selection.engineId}@${x.itemId}:${x.status}`)).toEqual([
      'claude-code@1.1:done',
      'claude-code@1.2:quota_exceeded',
      'codex@1.2:done',
      'codex@1.3:done',
    ]);
    // codex에게 준 첫 지시는 1.2부터 (1.1은 다시 하지 않음)
    expect(prompts[2]).toMatch(/^codex\|체크리스트의 다음 미완료 항목 1\.2 "항목 1\.2"부터/);

    // ── 리플레이: 이벤트 로그만으로 재개 지점을 다시 계산해 실제와 비교 ──
    const replayed: LogRecord[] = [];
    for await (const e of log.replay(S)) replayed.push(e);
    log.close();
    t.cleanup();

    const switchAt = replayed.findIndex((e) => e.type === 'error' && e.code === 'quota_exceeded');
    expect(switchAt).toBeGreaterThan(0);
    const status = new Map<string, string>();
    for (const e of replayed.slice(0, switchAt))
      if (e.type === 'checklist_change') status.set(String(e.changedItemId), String(e.to));
    const firstIncomplete = ['1.1', '1.2', '1.3'].find((id) => status.get(id) !== 'done');
    const firstCodex = replayed.find((e) => e.engineId === 'codex');
    expect(firstIncomplete).toBe('1.2');
    expect(firstCodex?.itemId).toBe(firstIncomplete);

    // 항목별 담당 엔진 순서, done 이후 같은 항목 재작업 없음
    const byItem = new Map<string, string[]>();
    for (const e of replayed)
      if (e.type === 'assistant_text' && typeof e.itemId === 'string')
        byItem.set(e.itemId, [...(byItem.get(e.itemId) ?? []), String(e.engineId)]);
    expect(Object.fromEntries(byItem)).toEqual({
      '1.1': ['claude-code'],
      '1.2': ['claude-code', 'codex'],
      '1.3': ['codex'],
    });
    const doing12 = replayed.filter(
      (e) => e.type === 'checklist_change' && e.changedItemId === '1.2' && e.to === 'doing',
    );
    expect(doing12).toHaveLength(1); // 엔진 전환 시 항목을 처음부터 다시 시작하지 않음
  });
});
