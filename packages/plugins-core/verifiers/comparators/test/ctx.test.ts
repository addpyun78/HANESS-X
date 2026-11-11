import type { Glossary, GlossaryIndex } from '@harness-x/checklist-ledger';
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  defaultCompareCtx,
  detectCompareOs,
  EquivalencesSchema,
  type CompareCtx,
  type CompareOs,
  type Equivalences,
} from '../src/types.js';
import { ctx } from './helpers.js';

describe('B.3 CompareCtx', () => {
  it('os · workspaceRoot · glossary · equivalences · itemTitle · sessionId', () => {
    expectTypeOf<CompareOs>().toEqualTypeOf<'win' | 'wsl' | 'posix'>();
    expectTypeOf<CompareCtx['os']>().toEqualTypeOf<CompareOs>();
    expectTypeOf<CompareCtx['workspaceRoot']>().toEqualTypeOf<string>();
    expectTypeOf<CompareCtx['glossary']>().toEqualTypeOf<Glossary | GlossaryIndex>();
    expectTypeOf<CompareCtx['equivalences']>().toEqualTypeOf<Equivalences>();
    expectTypeOf<CompareCtx['itemTitle']>().toEqualTypeOf<string>();
    expectTypeOf<CompareCtx['sessionId']>().toEqualTypeOf<string>();
    expect(Object.keys(ctx()).sort()).toEqual(
      ['equivalences', 'glossary', 'itemTitle', 'os', 'sessionId', 'workspaceRoot'].sort(),
    );
  });
  it('os 감지 (win·wsl·posix), 기본 ctx, equivalences 파일 스키마(기본 꺼짐)', () => {
    expect(detectCompareOs('win32', '10.0')).toBe('win');
    expect(detectCompareOs('linux', '6.6.87.2-microsoft-standard-WSL2')).toBe('wsl');
    expect(detectCompareOs('linux', '6.8.0-generic')).toBe('posix');
    expect(detectCompareOs('darwin', '24.0.0')).toBe('posix');
    const d = defaultCompareCtx({ itemTitle: '빌드', sessionId: 's1' });
    expect(d).toMatchObject({
      workspaceRoot: '',
      itemTitle: '빌드',
      sessionId: 's1',
      equivalences: { pairs: [], rules: [] },
    });
    expect(EquivalencesSchema.parse({})).toEqual({ version: 1, pairs: [], rules: [] });
    expect(EquivalencesSchema.safeParse({ rules: ['path.anything'] }).success).toBe(false);
  });
});
