import type { ToolCandidate } from './candidate.js';
import type { AutoResume } from './flow.js';
import type { ToolNeed } from './need.js';

/** 설치 관리자(Part 2)의 계획 만들기 — InstallService.plan과 같은 모양 */
export interface PlanMaker {
  plan(req: Record<string, unknown>): Promise<unknown>;
}

export interface SelectedPlan {
  candidateId: string;
  /** Part 2 설치 계획 (카드로 띄운다) */
  plan?: unknown;
  /** 자동 설치 방법이 없을 때 쉬운 말 이유 */
  reason?: string;
}

export const NO_INSTALL_METHOD = '자동으로 설치할 방법이 없어요. 공식 사이트에서 받아 주세요.';

/**
 * P3-C.4 [선택한 걸로 설치]: 고른 후보마다 순서대로 설치 계획(Part 2 계획 카드)을 만든다.
 * 실행은 하지 않는다 — 카드마다 사람이 승인해야 설치된다. D.1 자동 재개를 위해 기대 목록에 올린다.
 */
export async function planSelected(
  install: PlanMaker,
  need: Pick<ToolNeed, 'capability' | 'requiredBy'>,
  chosen: readonly ToolCandidate[],
  auto?: AutoResume,
): Promise<SelectedPlan[]> {
  const out: SelectedPlan[] = [];
  for (const c of chosen) {
    const m = c.installMethods[0];
    if (!m) {
      out.push({ candidateId: c.id, reason: NO_INSTALL_METHOD });
      continue;
    }
    auto?.expect(need, m);
    out.push({
      candidateId: c.id,
      plan: await install.plan({ kind: m.kind, target: { id: m.id, name: c.name } }),
    });
  }
  return out;
}
