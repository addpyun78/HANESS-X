import { basename } from 'node:path';
import { SECRET_PATTERNS } from '@harness-x/kernel';
import { inferCompareKind } from './infer.js';
import { defaultComparators, type ComparatorRegistry } from './registry.js';
import { asText, type CompareCtx, type CompareOptions, type CompareResult } from './types.js';

/**
 * 비교 진입점 (D.3·D.4)
 *  - kind가 'auto'면 기대값으로 추론(D.2)
 *  - 자동 엄격 대상(해시·체크섬 16진 32자 이상, 비밀번호·토큰 패턴, lockfile 버전 고정)은 semantic을 강제로 off (D.4)
 *  - `exact` 또는 `semantic: off`인데 비교기가 uncertain이면 의미 판단·승인 카드 없이 즉시 실패 (D.3)
 *  - next: pass(통과) | fail(실패) | semantic(의미 판단 칸으로 — judge 체인이 이어받는다)
 */

export type SemanticMode = 'auto' | 'off';

export interface CompareValuesOptions {
  /** 비교기 옵션 */
  options?: CompareOptions;
  semantic?: SemanticMode;
  /** 비교 대상 파일 이름 (lockfile 여부 판단, D.4) */
  file?: string;
  registry?: ComparatorRegistry;
}

export interface CompareOutcome extends CompareResult {
  kind: string;
  /** 실제로 적용된 semantic (엄격 대상이면 off) */
  semantic: SemanticMode;
  /** 자동 엄격 대상 사유 (D.4) */
  strict?: string;
  next: 'pass' | 'fail' | 'semantic';
  normalizedExpected: string;
  normalizedActual: string;
}

export const LOCKFILE_NAMES: readonly string[] = [
  'pnpm-lock.yaml',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'bun.lockb',
  'bun.lock',
  'Cargo.lock',
  'poetry.lock',
  'Pipfile.lock',
  'uv.lock',
  'Gemfile.lock',
  'composer.lock',
  'go.sum',
  'flake.lock',
  'plugins.lock',
];

const HEX_RE = /^(?:(?:sha(?:1|224|256|384|512)|md5|blake2b?|crc32)[:-])?[0-9a-f]{32,}$/i;
const CREDENTIAL_RE =
  /\b(?:password|passwd|pwd|passphrase|secret|token|api[_-]?key|access[_-]?key)\b\s*[:=]/i;
const JWT_RE = /^eyJ[\w-]+\.[\w-]+\.[\w-]+$/;

/** D.4 자동 엄격 대상인가 — 사유(없으면 undefined) */
export function strictReason(expected: unknown, actual: unknown, file?: string): string | undefined {
  if (file && LOCKFILE_NAMES.includes(basename(file.replace(/\\/g, '/'))))
    return `lockfile(${basename(file)}) 버전 고정`;
  for (const v of [expected, actual]) {
    const s = asText(v).trim();
    if (HEX_RE.test(s)) return '해시·체크섬(16진 32자 이상)';
    if (
      JWT_RE.test(s) ||
      CREDENTIAL_RE.test(s) ||
      SECRET_PATTERNS.some((p) => new RegExp(p.re.source).test(s))
    )
      return '비밀번호·토큰 패턴';
  }
  return undefined;
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
  const strict = strictReason(expected, actual, opts.file);
  const semantic: SemanticMode = strict ? 'off' : (opts.semantic ?? 'auto');
  const r = c.equals(expected, actual, ctx, opts.options);
  const base = {
    kind: k,
    semantic,
    ...(strict ? { strict } : {}),
    normalizedExpected: c.normalize(expected, ctx, opts.options),
    normalizedActual: c.normalize(actual, ctx, opts.options),
  };
  if (r.verdict === 'equal') return { ...r, ...base, next: 'pass' };
  if (r.verdict === 'different') return { ...r, ...base, next: 'fail' };
  // uncertain
  if (k === 'exact' || semantic === 'off') {
    const why = k === 'exact' ? 'exact 비교' : strict ? `엄격 대상: ${strict}` : 'semantic: off';
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
