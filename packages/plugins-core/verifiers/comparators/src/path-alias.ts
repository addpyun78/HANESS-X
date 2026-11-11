import {
  canonicalizeSegment,
  glossaryIndex,
  type Glossary,
  type GlossaryIndex,
} from '@harness-x/checklist-ledger';
import { normalizePath, type NormalizeOptions } from './path-normalize.js';

/**
 * 경로 별칭 사전 (판정 사다리 L2, T-025 25.2 → T-100 C.2에서 path 비교기로 이동)
 * L1 정규 키를 조각별로 단어 단위 glossary 치환(하네스 → harness, 모바일 → mobile)하고
 * 표기 관례(camelCase·snake_case·kebab-case·대소문자)를 하나로 맞춘 키로 비교한다.
 */

export interface AliasOptions extends NormalizeOptions {
  glossary: Glossary | GlossaryIndex;
}

/** 확장자는 보존하고 나머지를 단어 단위로 치환 */
function aliasSegment(seg: string, idx: GlossaryIndex): string {
  if (seg === '' || seg === '.' || seg === '..') return seg;
  const m = /^(.+?)(\.[A-Za-z0-9]+)$/.exec(seg);
  const base = m ? m[1]! : seg;
  const ext = m ? m[2]!.toLowerCase() : '';
  const value = canonicalizeSegment(base, idx).value;
  return (value || base.toLowerCase()) + ext;
}

/** 정규 키(normalizePath 결과) → L2 키 */
export function aliasKeyOf(normalizedKey: string, glossary: Glossary | GlossaryIndex): string {
  const idx = glossaryIndex(glossary);
  return normalizedKey
    .split('/')
    .map((s) => aliasSegment(s, idx))
    .join('/');
}

/** 경로 → L2 키 (L1 정규화 포함) */
export function aliasKey(path: string, opts: AliasOptions): string {
  return aliasKeyOf(normalizePath(path, opts), opts.glossary);
}
