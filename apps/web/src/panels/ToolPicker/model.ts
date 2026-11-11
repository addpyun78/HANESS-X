/**
 * "도구 고르기" 카드 화면 모델 (T-100 P3-C.3~C.8)
 * 서버 @harness-x/tool-finder의 FindResult(PickerCandidate)와 같은 모양을 웹에서 따로 정의한다 (웹은 Node 패키지를 번들하지 않는다).
 */

export const TOOL_PICKER_KIND = 'tool.picker';
export const TOOL_PICKER_TITLE = '이 작업에 도구가 필요해요';
export const PREVIOUS_CHOICE_LABEL = '지난번에 고른 도구';
export const RECOMMENDED_LABEL = '추천';

export type PricingTier = 'free' | 'freemium' | 'paid' | 'trial' | 'unknown';

/** P2-D.2와 같은 배지: 글자·색 (색은 디자인 토큰) */
export const PRICING_BADGES: Readonly<Record<PricingTier, { label: string; tone: string }>> = Object.freeze({
  free: { label: '무료', tone: 'green' },
  freemium: { label: '무료+유료 기능', tone: 'blue' },
  trial: { label: '체험판', tone: 'orange' },
  paid: { label: '유료', tone: 'red' },
  unknown: { label: '무료인지 확인 못 했어요', tone: 'yellow' },
});

/** 배지가 없는 후보는 그리지 않는다 (공통 원칙 3: 무료/유료는 반드시 표시) */
export class MissingPricingBadgeError extends Error {
  constructor(readonly candidate: string) {
    super(`무료/유료 배지가 없는 후보는 표시할 수 없어요: ${candidate}`);
    this.name = 'MissingPricingBadgeError';
  }
}

export function pricingBadge(name: string, tier: unknown): { label: string; tone: string } {
  const b = typeof tier === 'string' ? PRICING_BADGES[tier as PricingTier] : undefined;
  if (!b) throw new MissingPricingBadgeError(name);
  return b;
}

export interface InstallMethodData {
  kind: string;
  id: string;
  label: string;
}

export interface PickerCandidateData {
  id: string;
  name: string;
  summary: string;
  pricing: { tier: PricingTier; note: string; sourceUrl: string; checkedAt: string };
  license: string;
  officialUrl: string;
  installMethods: InstallMethodData[];
  os: string[];
  maintenance: { lastRelease: string | null; archived: boolean };
  trust: { level: string; reasons: string[] };
  pros: string[];
  cons: string[];
  sources: string[];
  reason: string;
  con: string;
  installLabel: string;
  checkedLabel: string;
  recommended: boolean;
  previous: boolean;
}

export interface ToolNeedData {
  capability: string;
  why: string;
  requiredBy?: { itemId: string } | { nodeId: string };
  constraints: { os: string; offline: boolean; budget: string };
  source: string;
}

/** 서버 FindResult(status: 'candidates') */
export interface ToolPickerData {
  id: string;
  need: ToolNeedData;
  candidates: PickerCandidateData[];
  recommendedId?: string;
  notices: string[];
}

export const PICKER_BUTTONS = [
  { id: 'install', label: '선택한 걸로 설치', primary: true },
  { id: 'url', label: '주소 직접 넣기' },
  { id: 'skip', label: '설치 없이 계속' },
] as const;
export type PickerButtonId = (typeof PICKER_BUTTONS)[number]['id'];

export function requiredByText(r: ToolNeedData['requiredBy']): string {
  if (!r) return '';
  return 'itemId' in r ? ` (항목 ${r.itemId})` : ` (에이전트 칸 ${r.nodeId})`;
}

/** 승인 카드와 같은 알림(Toasts)에 넣을 토스트 */
export function toolPickerToast(d: Pick<ToolPickerData, 'id' | 'need'>): {
  id: string;
  cardId: string;
  text: string;
} {
  return { id: `toast-${d.id}`, cardId: d.id, text: `🔧 도구가 필요해요: ${d.need.capability}` };
}

/** 처음 고른 상태: 추천 하나 */
export function initialSelection(d: Pick<ToolPickerData, 'candidates'>): string[] {
  const rec = d.candidates.find((c) => c.recommended);
  return rec ? [rec.id] : [];
}
