/**
 * 판정 사다리 L1 — 정규화 (25.1)
 * T-100 P1-C.2: 구현은 path 비교기(@harness-x/comparators)로 옮겼다. 사다리·권한 게이트 호환을 위해 다시 내보낸다.
 */
export {
  isWithinKey,
  normalizePath,
  pathsEqualL1,
  toPosixForm,
  type NormalizeOptions,
} from '@harness-x/comparators';
