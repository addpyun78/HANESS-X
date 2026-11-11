import { checkPlainKorean } from '@harness-x/approvals';
import type { ChecklistItem, ChecklistLedger } from '@harness-x/checklist-ledger';
import type { RegistryFile, ToolEntry, ToolRegistry } from '@harness-x/installer';
import type { InstallMethod, ToolCandidate } from './candidate.js';
import { needKey, type ToolNeed } from './need.js';

/**
 * 항목 상태 연결 (Part 3 C.6 · D.1 · D.2)
 *   도구 필요     → 항목 blocked + 증거 tool_needed
 *   C.6 설치 없이 계속 → "도구 없이 진행" 기록 + AI에게 대체 방법 지시(tool_skipped), 불가능하면 blocked(쉬운 말 이유)
 *   D.1 설치 성공 → 도구 목록 등록(필요 열쇠 태그) → 기다리던 항목 자동 재개(blocked → doing, tool_resumed 지시)
 *   D.2 유료 구매가 필요 → 항목은 "구매 대기"(blocked 유지), 다른 독립 항목은 계속
 */

export const TOOL_NEEDED = 'tool_needed';
export const TOOL_RESUMED = 'tool_resumed';
export const TOOL_SKIPPED = 'tool_skipped';
export const TOOL_UNAVAILABLE = 'tool_unavailable';
export const PURCHASE_WAITING = 'purchase_waiting';

export const SKIPPED_SUMMARY = '도구 없이 진행';
export const PURCHASE_WAITING_SUMMARY = '구매 대기';
export const UNAVAILABLE_TEMPLATE = '필요한 도구가 없어서 이 항목은 진행할 수 없어요.';

/** 항목이 지금 기다리는 필요 (마지막 tool_needed 증거, 아직 blocked일 때만) */
export function waitingNeedOf(item: ChecklistItem): string | undefined {
  if (item.status !== 'blocked') return undefined;
  const ev = [...item.evidence].reverse().find((e) => e.kind === TOOL_NEEDED);
  return typeof ev?.capability === 'string' ? ev.capability : undefined;
}

/** 도구가 필요해서 항목을 멈춘다 (todo·doing·verifying·failed → blocked) */
export function waitForTool(
  ledger: ChecklistLedger,
  itemId: string,
  need: Pick<ToolNeed, 'capability'>,
): void {
  const evidence = {
    kind: TOOL_NEEDED,
    capability: need.capability,
    summary: `필요한 도구를 기다려요: ${need.capability}`,
  };
  if (ledger.item(itemId).status === 'blocked') ledger.addEvidence(itemId, evidence);
  else ledger.transition(itemId, 'blocked', { evidence });
}

export type ContinueResult = { status: 'doing'; instruction: string } | { status: 'blocked'; reason: string };

/**
 * C.6 [설치 없이 계속].
 * possible: AI가 다른 방법으로 할 수 있다고 본 경우(대체 방법 설명은 alternative). 불가능하면 reason(쉬운 말)으로 blocked.
 */
export function continueWithoutTool(
  ledger: ChecklistLedger,
  itemId: string,
  need: Pick<ToolNeed, 'capability'>,
  o: { possible: true; alternative?: string } | { possible: false; reason?: string },
): ContinueResult {
  const item = ledger.item(itemId);
  if (o.possible) {
    const instruction =
      `도구 없이 진행: "${need.capability}" 도구는 설치하지 않기로 했어요. ` +
      `설치 없이 할 수 있는 다른 방법으로 이 항목을 해 주세요.` +
      (o.alternative ? ` 제안된 방법: ${o.alternative}` : '');
    const evidence = {
      kind: TOOL_SKIPPED,
      summary: SKIPPED_SUMMARY,
      capability: need.capability,
      instruction,
    };
    if (item.status === 'blocked') ledger.resume(itemId, { evidence });
    else ledger.addEvidence(itemId, evidence);
    return { status: 'doing', instruction };
  }
  const reason = o.reason && checkPlainKorean(o.reason).ok ? o.reason : UNAVAILABLE_TEMPLATE;
  const evidence = { kind: TOOL_UNAVAILABLE, summary: reason, capability: need.capability };
  if (item.status === 'blocked') ledger.addEvidence(itemId, evidence);
  else ledger.transition(itemId, 'blocked', { evidence });
  return { status: 'blocked', reason };
}

/** D.2 유료 도구를 골랐고 구매가 필요 → 구매 대기(blocked 유지). 다음에 할 독립 항목을 돌려준다 */
export function markPurchaseWaiting(
  ledger: ChecklistLedger,
  itemId: string,
  candidate: Pick<ToolCandidate, 'name' | 'officialUrl' | 'pricing'>,
): ChecklistItem | null {
  const evidence = {
    kind: PURCHASE_WAITING,
    summary: PURCHASE_WAITING_SUMMARY,
    tool: candidate.name,
    officialUrl: candidate.officialUrl,
    pricingSource: candidate.pricing.sourceUrl,
  };
  if (ledger.item(itemId).status === 'blocked') ledger.addEvidence(itemId, evidence);
  else ledger.transition(itemId, 'blocked', { evidence });
  return ledger.currentItem();
}

/** 구매 대기 중인가 */
export function isPurchaseWaiting(item: ChecklistItem): boolean {
  return item.status === 'blocked' && item.evidence.at(-1)?.kind === PURCHASE_WAITING;
}

export function resumedInstruction(t: Pick<ToolEntry, 'name' | 'command' | 'howToUse'>): string {
  return (
    `"${t.name}" 도구를 설치했어요. ` +
    (t.command ? `실행 파일(절대 경로): ${t.command}. ` : '') +
    `사용 예: ${t.howToUse.join(', ')}. 이 도구로 이 항목을 이어서 하세요.`
  );
}

interface Pending {
  need: Pick<ToolNeed, 'capability' | 'requiredBy'>;
  toolId: string;
}

/**
 * D.1 설치 성공 → 자동 재개.
 * 사람이 카드에서 고른 설치 방법을 expect()로 알려 두면, 도구 목록(registry)에 그 도구가 들어오는 순간
 *  ① 항목의 용도·태그에 필요(능력 설명)를 넣어 다시 저장하고 (다음 번엔 A.3 매칭으로 바로 찾는다)
 *  ② 그 필요를 기다리던 blocked 항목을 doing으로 되돌리며 다음 턴 지시(tool_resumed)를 남긴다.
 * AI는 다음 턴에 installed-tools 스킬(Part 2 F.3·F.5 핫리로드)과 이 지시로 바로 쓴다.
 */
export class AutoResume {
  private readonly pending = new Map<string, Pending>();
  private busy = false;

  constructor(
    private readonly o: {
      registry: ToolRegistry;
      ledgers: () => readonly ChecklistLedger[];
      events?: { append(ev: { type: string } & Record<string, unknown>): unknown };
    },
  ) {}

  /** 사람이 이 설치 방법으로 설치를 시작했다 */
  expect(
    need: Pick<ToolNeed, 'capability' | 'requiredBy'>,
    method: Pick<InstallMethod, 'kind' | 'id'>,
  ): void {
    const toolId = `${method.kind}:${method.id}`;
    this.pending.set(toolId, { need, toolId });
  }

  /** registry.onChange 구독. 해제 함수 반환 */
  start(): () => void {
    return this.o.registry.onChange((r) => this.handle(r));
  }

  /** 도구 목록이 바뀌었을 때 (직접 불러도 된다) */
  handle(r: RegistryFile = this.o.registry.read()): { resumed: string[] } {
    if (this.busy) return { resumed: [] };
    const resumed: string[] = [];
    this.busy = true;
    try {
      for (const [toolId, p] of [...this.pending]) {
        const entry = r.tools.find((t) => t.id === toolId);
        if (!entry) continue;
        this.pending.delete(toolId);
        const tagged = this.tag(entry, p.need.capability);
        for (const ledger of this.o.ledgers()) {
          const c = ledger.read();
          if (!c) continue;
          for (const it of c.items) {
            const waiting = waitingNeedOf(it);
            const forItem =
              p.need.requiredBy && 'itemId' in p.need.requiredBy && p.need.requiredBy.itemId === it.id;
            if (!waiting || (needKey(waiting) !== needKey(p.need.capability) && !forItem)) continue;
            ledger.resume(it.id, {
              evidence: {
                kind: TOOL_RESUMED,
                summary: `도구 설치 완료: ${tagged.name}`,
                toolId,
                instruction: resumedInstruction(tagged),
              },
            });
            resumed.push(it.id);
          }
        }
        this.o.events?.append({ type: 'tool_resumed', toolId, items: resumed });
      }
    } finally {
      this.busy = false;
    }
    return { resumed };
  }

  /** 기대 중인 도구 id 목록 */
  expected(): string[] {
    return [...this.pending.keys()];
  }

  private tag(entry: ToolEntry, capability: string): ToolEntry {
    if (entry.capabilities.some((c) => needKey(c) === needKey(capability))) return entry;
    return this.o.registry.upsert({
      ...entry,
      purpose: capability,
      capabilities: [...entry.capabilities, capability],
    });
  }
}
