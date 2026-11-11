import { CompareEvidenceSchema } from '@harness-x/checklist-ledger';
import { describe, expect, it } from 'vitest';
import { compareValues } from '../src/compare.js';
import { compareEvidence } from '../src/evidence.js';
import { ctx } from './helpers.js';

const TS = '2026-11-11T00:00:00.000Z';

describe('F.1 evidence.compare', () => {
  it('정규화 일치 · 사전 일치 · 의미 판단 증거 (스냅샷)', () => {
    const norm = compareEvidence(compareValues('text', 'build ok\n', 'build  ok\r\n', ctx()), { ts: TS });
    const dict = compareEvidence(compareValues('path', '하네스/모바일', 'harness/mobile', ctx()), { ts: TS });
    const semantic = compareEvidence(
      {
        ...compareValues('text', '완료', '작업이 끝났습니다', ctx()),
        verdict: 'equal',
        level: 'semantic',
        confidence: 0.93,
        reason: '같은 뜻',
      },
      { ts: TS, judgeEngine: 'claude-code', samples: 3 },
    );
    for (const e of [norm, dict, semantic]) expect(CompareEvidenceSchema.parse(e)).toEqual(e);
    expect([norm, dict, semantic]).toMatchSnapshot();
    expect(semantic.compare).toEqual({
      kind: 'text',
      level: 'semantic',
      verdict: 'equal',
      confidence: 0.93,
      judgeEngine: 'claude-code',
      samples: 3,
      normalizedExpected: '완료',
      normalizedActual: '작업이 끝났습니다',
    });
  });
  it('정규화 값은 길이 상한으로 자른다', () => {
    const e = compareEvidence(compareValues('text', 'x'.repeat(50), 'y'.repeat(50), ctx()), {
      maxValueLength: 10,
    });
    expect(e.compare.normalizedExpected).toBe(`${'x'.repeat(10)}…`);
  });
});
