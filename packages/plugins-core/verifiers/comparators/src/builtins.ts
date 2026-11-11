import { exactComparator } from './comparators/exact.js';
import type { Comparator } from './types.js';

/** 기본 비교기 (T-100 C.1~C.12에서 하나씩 등록) */
export const BUILTIN_COMPARATORS: readonly Comparator[] = Object.freeze([exactComparator] as Comparator[]);

export const BUILTIN_COMPARATOR_KINDS = BUILTIN_COMPARATORS.map((c) => c.kind);
