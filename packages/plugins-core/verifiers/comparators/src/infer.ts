import { parseNumber } from './comparators/number.js';

/**
 * D.2 비교기 종류 자동 추론 (기대값만 본다)
 *   JSON(객체·배열) → json, semver(`v1.2`, `1.2.3`) → version, 숫자 → number, 경로 → path, 그 외 → text
 * `1.2`처럼 숫자와 버전이 겹치면 숫자로 본다(`v`가 붙거나 세 자리일 때만 버전).
 */
export type InferredCompareKind = 'path' | 'json' | 'number' | 'version' | 'text';

const SEMVER_RE = /^(?:[vV]\d+(?:\.\d+){0,2}|\d+\.\d+\.\d+)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const URL_RE = /^[a-z][a-z0-9+.-]*:\/\//i;
const FILE_RE = /^[\p{L}\p{N}_.-]+\.[A-Za-z0-9]{1,8}$/u;

function looksLikeJson(s: string): boolean {
  if (!/^[[{]/.test(s)) return false;
  try {
    const v: unknown = JSON.parse(s);
    return v !== null && typeof v === 'object';
  } catch {
    return false;
  }
}

function looksLikePath(s: string): boolean {
  if (/\s/.test(s) || URL_RE.test(s)) return false;
  if (/^(?:[A-Za-z]:[\\/]|\\\\|~[\\/]|\.{1,2}[\\/]|\/)/.test(s)) return true;
  if (/[\\/]/.test(s)) return s.split(/[\\/]+/).filter(Boolean).length >= 1;
  return FILE_RE.test(s);
}

export function inferCompareKind(expected: unknown): InferredCompareKind {
  if (typeof expected === 'number') return 'number';
  if (expected !== null && typeof expected === 'object') return 'json';
  if (typeof expected !== 'string') return 'text';
  const s = expected.trim();
  if (s === '') return 'text';
  if (looksLikeJson(s)) return 'json';
  if (SEMVER_RE.test(s)) return 'version';
  if (parseNumber(s) !== null) return 'number';
  if (looksLikePath(s)) return 'path';
  return 'text';
}
