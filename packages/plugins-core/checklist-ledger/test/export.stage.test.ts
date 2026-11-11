import { describe, expect, it } from 'vitest';
import { compareStageLabel, renderChecklistMarkdown } from '../src/export.js';
import { ChecklistLedger } from '../src/ledger.js';
import { CompareEvidenceSchema } from '../src/schema.js';
import { item, tempDir } from './helpers.js';

const T = () => new Date('2026-11-11T00:00:00.000Z');
const cmp = (level: string, extra: Record<string, unknown> = {}, verdict = 'equal') => ({
  kind: 'compare',
  summary: `${level} ${verdict}`,
  compare: {
    kind: 'text',
    level,
    verdict,
    confidence: 1,
    normalizedExpected: 'a',
    normalizedActual: 'b',
    ...extra,
  },
});

describe('T-100 F.5 CHECKLIST.md 판정 단계 표시', () => {
  it('자동 정리로 일치 / 사전 일치 / AI 판단(엔진명, 0.93) / 사용자 승인 (스냅샷)', () => {
    const { dir, cleanup } = tempDir();
    try {
      const l = new ChecklistLedger({ dir, sessionId: 's1', now: T, idGen: () => 'id' });
      l.create([item('1'), item('2'), item('3'), item('4'), item('5')]);
      const done = (id: string, ev: unknown) => {
        l.transition(id, 'doing');
        l.transition(id, 'verifying');
        l.transition(id, 'done', { evidence: ev as never });
      };
      done('1', cmp('normalize'));
      done('2', cmp('dictionary'));
      done('3', cmp('semantic', { confidence: 0.93, judgeEngine: 'codex', samples: 3 }));
      done('4', [cmp('semantic', { confidence: 0.75, judgeEngine: 'ollama' }, 'uncertain'), cmp('human')]);
      l.addEvidence('5', cmp('normalize', {}, 'different'));
      const md = renderChecklistMarkdown(l.read(), { title: '판정 단계' });
      expect(md).toMatchSnapshot();
      expect(md).toContain('  - 판정 단계: 자동 정리로 일치');
      expect(md).toContain('  - 판정 단계: 사전 일치');
      expect(md).toContain('  - 판정 단계: AI 판단(codex, 0.93)');
      expect(md).toContain('  - 판정 단계: 사용자 승인');
      // 일치하지 않은 비교만 있는 항목에는 판정 단계 줄이 없다
      expect(md.split('\n').filter((x) => x.includes('판정 단계:'))).toHaveLength(4);
    } finally {
      cleanup();
    }
  });

  it('엔진 이름이 없으면 "엔진 모름"', () => {
    expect(compareStageLabel(CompareEvidenceSchema.parse(cmp('semantic', { confidence: 0.912 })))).toBe(
      'AI 판단(엔진 모름, 0.91)',
    );
  });
});
