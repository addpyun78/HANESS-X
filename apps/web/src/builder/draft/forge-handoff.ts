import type { DraftGap } from '@harness-x/protocol';
import { navigate } from '../../router.js';

/**
 * P4-C.11 [Forge로 만들기]: 빈 칸 설명을 Forge 인터뷰 첫 답으로 넘긴다.
 * Forge 화면(대화 입력창)에 "/forge <설명>"을 채워 두기만 하고 보내지 않는다 — 진행은 사용자가 한다.
 */

export const FORGE_PREFILL_KEY = 'hx.forge.prefill';

export const forgePrefillText = (gap: Pick<DraftGap, 'need'>) => `/forge ${gap.need}`;

export function handOffToForge(gap: Pick<DraftGap, 'need'>, go: (path: string) => void = navigate): void {
  try {
    sessionStorage.setItem(FORGE_PREFILL_KEY, forgePrefillText(gap));
  } catch {
    // 저장소를 못 쓰면 채우기 없이 이동만 한다
  }
  go('/');
}

/** 한 번만 꺼낸다 (새로고침해도 다시 채우지 않는다) */
export function takeForgePrefill(): string | undefined {
  try {
    const v = sessionStorage.getItem(FORGE_PREFILL_KEY) ?? undefined;
    sessionStorage.removeItem(FORGE_PREFILL_KEY);
    return v || undefined;
  } catch {
    return undefined;
  }
}
