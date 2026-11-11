import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createAiAcceptTracker, openSessionApprovals } from '@harness-x/approvals';
import { ChecklistLedger, loadDefaultGlossary } from '@harness-x/checklist-ledger';
import { defaultCompareCtx } from '@harness-x/comparators';
import type { JudgeOutcome, JudgeRequest } from '@harness-x/judge';
import { createComparePipeline, type SemanticJudge } from '@harness-x/verifier-ladder';
import { describe, expect, it } from 'vitest';
import { tempDir } from './helpers.js';

/**
 * T-100 G.4 승인 카드 E2E
 *   의미 판단 신뢰도 0.75(0.6~0.9) → 승인 카드 → ① "같은 걸로 인정" + "다음부터 자동" → 항목 done(level human)
 *   → 같은 쌍을 다시 비교하면 사전(equivalences.json)에서 일치 — 판정 AI를 다시 부르지 않는다
 */

/** 신뢰도 0.75로 "잘 모르겠다"고 답하는 판정 체인 (모킹) */
function uncertainJudge(): SemanticJudge & { calls: JudgeRequest[] } {
  const calls: JudgeRequest[] = [];
  return {
    calls,
    settings: { semantic: 'on' },
    async judge(req): Promise<JudgeOutcome> {
      calls.push(req);
      return {
        verdict: 'uncertain',
        confidence: 0.75,
        engineId: 'codex',
        samples: 3,
        differenceKind: 'equivalent',
        plainReason: '두 문장 모두 일이 끝났다는 뜻이에요.',
        reason: 'mock 0.75',
      };
    },
  };
}

describe('G.4 승인 카드: 0.75 → 카드 → ① 선택 → done → 다음엔 사전 일치', () => {
  it('카드 → 같은 걸로 인정 + 다음부터 자동 → 항목 done → 재비교는 dictionary', async () => {
    const tmp = tempDir('hx-e2e-g4-');
    try {
      const ws = tmp.dir;
      const sessionId = 's-g4';
      // 체크리스트가 있는 세션 → 승인 카드 선택이 항목에 반영된다
      const ledger = new ChecklistLedger({ dir: join(ws, '.harness-x', 'sessions', sessionId), sessionId });
      ledger.create([
        {
          id: '1',
          title: '완료 안내 문구',
          artifactId: 'art.done-message',
          acceptance: [{ type: 'command', run: 'true' }],
        },
      ]);
      ledger.transition('1', 'doing');
      ledger.transition('1', 'verifying');
      const opened = openSessionApprovals(ws, sessionId, { remindDelaysMs: [] });
      const judge = uncertainJudge();
      const pipeline = createComparePipeline({
        judge,
        approvals: opened.store,
        dictionary: opened.dictionary,
        aiAccepts: createAiAcceptTracker({ file: join(ws, '.harness-x', 'ai-accepts.json') }),
        sessionId,
      });
      const ctx = defaultCompareCtx({ workspaceRoot: ws, glossary: loadDefaultGlossary() });
      const compare = () =>
        pipeline.compare({
          kind: 'text',
          expected: '완료',
          actual: '작업이 끝났습니다',
          ctx,
          itemId: '1',
          itemTitle: '완료 안내 문구',
        });

      // 1) 신뢰도 0.75 → 승인 카드, 항목은 그대로(사람 결정 대기)
      const first = await compare();
      expect(first.status).toBe('awaiting');
      expect(judge.calls).toHaveLength(1);
      const [card] = opened.store.pending();
      expect(card).toMatchObject({
        kind: 'text',
        itemId: '1',
        confidenceWord: '중간',
        recommendation: 'accept',
        recommendationReason: '두 문장 모두 일이 끝났다는 뜻이에요.',
        technical: { confidence: 0.75, judgeEngine: 'codex', expected: '완료', actual: '작업이 끝났습니다' },
      });
      expect(card!.options[0]).toEqual({ id: 'accept', label: '같은 걸로 인정' });
      expect(ledger.item('1').status).toBe('verifying');

      // 2) ① "같은 걸로 인정" + "다음부터 자동"
      const res = opened.store.resolve(card!.id, card!.options[0]!.id, { remember: true, by: 'human' });
      expect(res.outcome).toMatchObject({ status: 'done', level: 'human' });
      const item = ledger.item('1');
      expect(item.status).toBe('done');
      expect(item.evidence.at(-1)).toMatchObject({ level: 'human', choice: 'accept', remember: true });
      expect(opened.store.pending()).toEqual([]);
      expect(existsSync(opened.dictionary.equivalencesFile)).toBe(true);
      expect(JSON.parse(readFileSync(opened.dictionary.equivalencesFile, 'utf8')).pairs).toMatchObject([
        { kind: 'text', a: '완료', b: '작업이 끝났습니다' },
      ]);

      // 3) 다음 비교: 사전에서 일치 — 판정 AI 호출·카드 없음
      const again = await compare();
      expect(again).toMatchObject({
        status: 'pass',
        aiJudged: false,
        outcome: { verdict: 'equal', level: 'dictionary' },
        evidence: { compare: { level: 'dictionary', verdict: 'equal' } },
      });
      expect(judge.calls).toHaveLength(1);
      expect(opened.store.pending()).toEqual([]);
      opened.store.dispose();
    } finally {
      tmp.cleanup();
    }
  });
});
