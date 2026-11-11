import { describe, expect, it } from 'vitest';
import { ChecklistLedger } from '../src/ledger.js';
import { hasAiJudgedEvidence } from '../src/schema.js';
import { item, tempDir } from './helpers.js';

const cmp = (level: string, verdict = 'equal') => ({
  kind: 'compare',
  summary: `text ${verdict} (${level})`,
  compare: {
    kind: 'text',
    level,
    verdict,
    confidence: level === 'semantic' ? 0.93 : 1,
    ...(level === 'semantic' ? { judgeEngine: 'codex', samples: 3 } : {}),
    normalizedExpected: '완료',
    normalizedActual: '작업이 끝났습니다',
  },
});

describe('T-100 F.2 의미 판단으로 통과한 항목 ai_judged: true', () => {
  it('semantic equal 비교 증거가 들어오면 항목에 ai_judged: true', () => {
    const { dir, cleanup } = tempDir();
    try {
      const l = new ChecklistLedger({ dir, sessionId: 's1' });
      l.create([item('1'), item('2'), item('3')]);
      for (const id of ['1', '2']) {
        l.transition(id, 'doing');
        l.transition(id, 'verifying');
      }
      l.transition('1', 'done', { evidence: cmp('semantic') });
      l.transition('2', 'done', { evidence: cmp('normalize') });
      l.addEvidence('3', cmp('semantic', 'uncertain'));
      expect(l.item('1').ai_judged).toBe(true);
      expect(l.item('2').ai_judged).toBeUndefined();
      expect(l.item('3').ai_judged).toBeUndefined();
      l.addEvidence('3', cmp('semantic'));
      expect(l.item('3').ai_judged).toBe(true);
    } finally {
      cleanup();
    }
  });

  it('hasAiJudgedEvidence: semantic + equal만 true', () => {
    expect(hasAiJudgedEvidence([cmp('semantic')])).toBe(true);
    expect(hasAiJudgedEvidence([cmp('dictionary'), cmp('human')])).toBe(false);
    expect(hasAiJudgedEvidence([cmp('semantic', 'different')])).toBe(false);
    expect(hasAiJudgedEvidence([{ kind: 'test_failed' }])).toBe(false);
  });
});
