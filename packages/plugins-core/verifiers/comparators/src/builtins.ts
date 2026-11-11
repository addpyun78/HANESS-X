import { exactComparator } from './comparators/exact.js';
import { pathComparator } from './comparators/path.js';
import { textComparator } from './comparators/text.js';
import { jsonComparator } from './comparators/json.js';
import { numberComparator } from './comparators/number.js';
import { versionComparator } from './comparators/version.js';
import { regexComparator } from './comparators/regex.js';
import type { Comparator } from './types.js';

/** 기본 비교기 (T-100 C.1~C.12에서 하나씩 등록) */
export const BUILTIN_COMPARATORS: readonly Comparator[] = Object.freeze([
  exactComparator,
  pathComparator,
  textComparator,
  jsonComparator,
  numberComparator,
  versionComparator,
  regexComparator,
] as Comparator[]);

export const BUILTIN_COMPARATOR_KINDS = BUILTIN_COMPARATORS.map((c) => c.kind);
