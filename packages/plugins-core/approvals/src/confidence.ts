/**
 * 신뢰도 숫자 → 말 (T-100 H.3). 숫자 자체는 "자세히 보기"에만 둔다.
 *   0.9 이상 "높음" · 0.8~0.9 "높은 편" · 0.7~0.8 "중간" · 0.6~0.7 "낮은 편" · 0.6 미만 "낮음"
 *   숫자가 없으면(판정할 AI 없음·횟수 초과) "알 수 없음"
 */
export function confidenceWord(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '알 수 없음';
  if (n >= 0.9) return '높음';
  if (n >= 0.8) return '높은 편';
  if (n >= 0.7) return '중간';
  if (n >= 0.6) return '낮은 편';
  return '낮음';
}
