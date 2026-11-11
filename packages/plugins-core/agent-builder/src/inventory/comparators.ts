import type { ComparatorAsset } from './schema.js';

/**
 * 비교기 종류 (Part 1 P1-C). @harness-x/comparators가 생기면 그 레지스트리로 바꾼다 — 지금은 고정 목록.
 */
export const COMPARATOR_KINDS = [
  'exact',
  'path',
  'text',
  'json',
  'number',
  'version',
  'regex',
  'exitCode',
] as const;
export type ComparatorKind = (typeof COMPARATOR_KINDS)[number];

const DESCRIPTION: Record<ComparatorKind, string> = {
  exact: '글자 그대로 같은지 (융통성 없음)',
  path: '파일 경로가 같은 곳을 가리키는지 (구분자·대소문자·WSL 경로 차이 허용)',
  text: '글 내용이 같은지 (줄 끝 공백·줄바꿈 차이 무시)',
  json: 'JSON 구조가 같은지 (키 순서 무시)',
  number: '숫자가 같은지 (천 단위 쉼표·허용 오차)',
  version: '버전 번호 비교',
  regex: '정해진 패턴에 맞는지',
  exitCode: '명령 종료 코드가 기대값인지',
};

export function collectComparators(kinds: readonly string[] = COMPARATOR_KINDS): ComparatorAsset[] {
  return kinds.map((kind) => ({ kind, description: DESCRIPTION[kind as ComparatorKind] ?? '' }));
}
