import { inferCompareKind } from './infer.js';
import { defaultComparators, type ComparatorRegistry } from './registry.js';
import { type CompareCtx, type CompareOptions, type CompareResult } from './types.js';

/**
 * 비교 진입점 (D.3·D.4)
 *  - kind가 'auto'면 기대값으로 추론(D.2)
 *  - `exact` 또는 `semantic: off`인데 비교기가 uncertain이면 의미 판단·승인 카드 없이 즉시 실패 (D.3)
 *  - next: pass(통과) | fail(실패) | semantic(의미 판단 칸으로 — judge 체인이 이어받는다)
 */

export type SemanticMode = 'auto' | 'off';

export interface CompareValuesOptions {
  /** 비교기 옵션 */
  options?: CompareOptions;
  semantic?: SemanticMode;
  registry?: ComparatorRegistry;
}

export interface CompareOutcome extends CompareResult {
  kind: string;
  semantic: SemanticMode;
  next: 'pass' | 'fail' | 'semantic';
  normalizedExpected: string;
  normalizedActual: string;
}

export function compareValues(
  kind: string,
  expected: unknown,
  actual: unknown,
  ctx: CompareCtx,
  opts: CompareValuesOptions = {},
): CompareOutcome {
  const registry = opts.registry ?? defaultComparators;
  const k = kind === 'auto' ? inferCompareKind(expected) : kind;
  const c = registry.require(k);
  const semantic: SemanticMode = opts.semantic ?? 'auto';
  const r = c.equals(expected, actual, ctx, opts.options);
  const base = {
    kind: k,
    semantic,
    normalizedExpected: c.normalize(expected, ctx, opts.options),
    normalizedActual: c.normalize(actual, ctx, opts.options),
  };
  if (r.verdict === 'equal') return { ...r, ...base, next: 'pass' };
  if (r.verdict === 'different') return { ...r, ...base, next: 'fail' };
  // uncertain
  if (k === 'exact' || semantic === 'off') {
    const why = k === 'exact' ? 'exact 비교' : 'semantic: off';
    return {
      ...r,
      ...base,
      verdict: 'different',
      confidence: 1,
      reason: `${r.reason} → ${why}라 의미 판단 없이 실패`,
      next: 'fail',
    };
  }
  return { ...r, ...base, next: 'semantic' };
}
