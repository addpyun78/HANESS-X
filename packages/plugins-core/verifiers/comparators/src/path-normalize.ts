/**
 * 경로 정규화 (T-100 C.2 path 비교기). T-101 0B.5에서 프로젝트 경로 비교도 같은 규칙을 쓰도록
 * 구현을 커널(`@harness-x/kernel`의 path-normalize)로 옮겼다 — 여기서는 그대로 다시 내보낸다.
 */
export { isWithinKey, normalizePath, toPosixForm, type NormalizeOptions } from '@harness-x/kernel';
