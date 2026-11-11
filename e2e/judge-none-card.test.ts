import { checkPlainKorean, openSessionApprovals, screenText } from '@harness-x/approvals';
import { ChecklistLedger, loadDefaultGlossary } from '@harness-x/checklist-ledger';
import { defaultCompareCtx } from '@harness-x/comparators';
import { createJudgeChain } from '@harness-x/judge';
import { createComparePipeline } from '@harness-x/verifier-ladder';
import { describe, expect, it } from 'vitest';
import { tempDir } from './helpers.js';

/**
 * T-100 G.5 E2E — 판정 AI 전부 불가
 *   ① judge.engine 미감지 · ② Ollama 꺼짐 · ③ 로그인된 구독 엔진 없음
 *   → ④ "판정해 줄 AI가 연결돼 있지 않아요" 승인 카드 (스냅샷). 항목은 자동으로 통과·실패하지 않는다.
 */
describe('G.5 판정 AI 전부 불가 → "판정해 줄 AI가 연결돼 있지 않아요" 카드', () => {
  it('카드 스냅샷 (쉬운 말 검사 통과)', async () => {
    const tmp = tempDir('hx-e2e-g5-');
    try {
      const sessionId = 's-g5';
      const hx = `${tmp.dir}/.harness-x/sessions/${sessionId}`;
      const ledger = new ChecklistLedger({ dir: hx, sessionId });
      ledger.create([
        {
          id: '3.1',
          title: '저장 버튼 안내 문구',
          artifactId: 'art.save-button',
          acceptance: [{ type: 'command', run: 'true' }],
        },
      ]);
      const opened = openSessionApprovals(tmp.dir, sessionId, { remindDelaysMs: [], idGen: () => 'ev-1' });
      const probes: string[] = [];
      const chain = createJudgeChain(
        { engine: 'claude-code' },
        {
          listEngines: () => [
            { id: 'claude-code', detected: false, loggedIn: false, authMode: 'subscription' },
            { id: 'codex', detected: true, loggedIn: false, authMode: 'subscription' },
          ],
          probeOllama: async () => {
            probes.push('ollama');
            return { running: false, models: [] };
          },
          createEngineJudge: () => {
            throw new Error('판정 엔진을 만들면 안 됨');
          },
        },
      );
      const pipeline = createComparePipeline({
        judge: chain,
        approvals: opened.store,
        dictionary: opened.dictionary,
        sessionId,
        idGen: () => 'card-g5',
        now: () => new Date('2026-11-11T09:00:00.000Z'),
      });
      const r = await pipeline.compare({
        kind: 'auto',
        expected: '저장 완료',
        actual: '저장됨',
        ctx: defaultCompareCtx({ workspaceRoot: tmp.dir, glossary: loadDefaultGlossary() }),
        itemId: '3.1',
        itemTitle: '저장 버튼 안내 문구',
      });
      expect(r.status).toBe('awaiting');
      expect(r.judge).toMatchObject({ verdict: 'unavailable', reason: 'no-judge' });
      expect(probes).toEqual(['ollama']);

      const [card] = opened.store.pending();
      expect(card).toBeDefined();
      expect(card!.whyAsking).toBe('판정해 줄 AI가 연결돼 있지 않아요.');
      for (const line of [card!.whatHappened, card!.whyAsking])
        expect(checkPlainKorean(line).ok, line).toBe(true);
      for (const o of card!.options)
        expect(checkPlainKorean(o.label, { label: true }).ok, o.label).toBe(true);
      expect(card).toMatchSnapshot();
      expect(screenText(card!)).toMatchSnapshot();
      expect(ledger.item('3.1').status).toBe('todo');
      opened.store.dispose();
    } finally {
      tmp.cleanup();
    }
  });
});
