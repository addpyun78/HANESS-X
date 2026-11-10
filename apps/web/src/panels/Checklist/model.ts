import type { HarnessEvent } from '@harness-x/protocol';

/**
 * 체크리스트 패널 모델 (T-036)
 * 서버 GET /api/checklist/:session 응답(checklist-ledger plan-routes.ts의 ChecklistView)과 같은 모양.
 * 웹은 checklist-ledger(node 전용)에 의존하지 않으므로 필요한 필드만 구조적으로 적는다.
 */

export type ItemStatus = 'todo' | 'doing' | 'verifying' | 'done' | 'failed' | 'blocked';

export interface Acceptance {
  type: string;
  run?: string;
  file?: string;
  symbol?: string;
  requiredKeys?: string[];
  prompt?: string;
  expectExit?: number;
}

export interface Evidence {
  kind: string;
  ts?: string;
  summary?: string;
  [k: string]: unknown;
}

export interface Verdict {
  level: number;
  verdict: string;
  confidence: number;
  reason: string;
}

export interface ChecklistItem {
  id: string;
  parent: string | null;
  title: string;
  owner: string | null;
  deps: string[];
  artifactId: string;
  acceptance: Acceptance[];
  status: ItemStatus;
  attempts: number;
  evidence: Evidence[];
  verdict?: Verdict;
}

export interface LintViolation {
  rule: string;
  itemId: string;
  message: string;
}

export interface ChecklistView {
  sessionId: string;
  checklist: { revision: number; version: number; updatedAt: string; items: ChecklistItem[] };
  currentItemId: string | null;
  plan: {
    locked: boolean;
    lockedAt?: string;
    revision: number;
    artifacts: Record<string, { displayName: string; path: string; kind: string }>;
  };
  lint: { ok: boolean; violations: LintViolation[] };
}

export const STATUS_ICON: Record<ItemStatus, string> = {
  todo: '○',
  doing: '◐',
  verifying: '◑',
  done: '●',
  failed: '✕',
  blocked: '⊘',
};

export const STATUS_LABEL: Record<ItemStatus, string> = {
  todo: '대기',
  doing: '진행 중',
  verifying: '검증 중',
  done: '완료',
  failed: '실패',
  blocked: '막힘',
};

const STATUSES = new Set<string>(Object.keys(STATUS_ICON));

export interface TreeNode {
  item: ChecklistItem;
  depth: number;
  children: TreeNode[];
}

/** parent 관계로 트리를 만든다 (정의 순서 유지, 없는 parent는 최상위로) */
export function buildTree(items: readonly ChecklistItem[]): TreeNode[] {
  const ids = new Set(items.map((i) => i.id));
  const byParent = new Map<string | null, ChecklistItem[]>();
  for (const it of items) {
    const p = it.parent !== null && ids.has(it.parent) ? it.parent : null;
    byParent.set(p, [...(byParent.get(p) ?? []), it]);
  }
  const make = (parent: string | null, depth: number, seen: Set<string>): TreeNode[] =>
    (byParent.get(parent) ?? [])
      .filter((it) => !seen.has(it.id))
      .map((it) => {
        const next = new Set(seen).add(it.id);
        return { item: it, depth, children: make(it.id, depth + 1, next) };
      });
  return make(null, 0, new Set());
}

export function progressOf(items: readonly ChecklistItem[]): { done: number; total: number; ratio: number } {
  const done = items.filter((i) => i.status === 'done').length;
  return { done, total: items.length, ratio: items.length ? done / items.length : 0 };
}

/** 진행 중(doing/verifying/failed) 또는 의존이 모두 끝난 첫 todo — 서버 currentItemOf와 같은 규칙 */
export function currentItemId(items: readonly ChecklistItem[]): string | null {
  const active = items.find((i) => i.status === 'doing' || i.status === 'verifying' || i.status === 'failed');
  if (active) return active.id;
  const done = new Set(items.filter((i) => i.status === 'done').map((i) => i.id));
  return items.find((i) => i.status === 'todo' && i.deps.every((d) => done.has(d)))?.id ?? null;
}

/**
 * 36.2 checklist_change 하나를 화면 모델에 바로 반영 (서버 재조회 전에도 상태가 보이도록).
 * 이미 더 새 version을 받았으면 무시. 'removed'면 항목을 뺀다.
 */
export function applyChecklistChange(view: ChecklistView, ev: HarnessEvent): ChecklistView {
  if (ev.type !== 'checklist_change' || ev.sessionId !== view.sessionId) return view;
  if (ev.version < view.checklist.version) return view;
  let items = view.checklist.items;
  if (ev.to === 'removed') items = items.filter((i) => i.id !== ev.changedItemId);
  else if (STATUSES.has(ev.to))
    items = items.map((i) => (i.id === ev.changedItemId ? { ...i, status: ev.to as ItemStatus } : i));
  else return view;
  return {
    ...view,
    checklist: { ...view.checklist, version: ev.version, items },
    currentItemId: currentItemId(items),
  };
}

// ── 36.3 판정 사다리 결과 ────────────────────────────────────────
export interface LadderStep {
  level: number;
  verdict: string;
  /** 0~1 */
  confidence: number;
  reason: string;
  ts?: string;
  decision?: string;
}

export const LADDER_LEVEL_LABEL: Record<number, string> = {
  1: '정규화',
  2: '별칭 사전',
  3: '내용 증거',
  4: '경량 판정 모델',
  5: '상위 검증',
};

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/**
 * 항목의 사다리 결과 (L1~L5): evidence 중 level·confidence가 있는 것(ladder_verdict, L5 승인 등)을
 * 기록 순서대로, 마지막으로 항목 verdict가 증거에 없으면 덧붙인다.
 */
export function ladderSteps(item: ChecklistItem): LadderStep[] {
  const steps: LadderStep[] = [];
  for (const e of item.evidence) {
    const level = num(e.level);
    const confidence = num(e.confidence) ?? num(e.probability);
    if (level === undefined || level < 1 || level > 5 || confidence === undefined) continue;
    const ts = str(e.ts);
    const decision = str(e.decision);
    steps.push({
      level,
      verdict: str(e.verdict) ?? '',
      confidence,
      reason: str(e.reason) ?? e.summary ?? '',
      ...(ts ? { ts } : {}),
      ...(decision ? { decision } : {}),
    });
  }
  const v = item.verdict;
  if (
    v &&
    !steps.some(
      (s) =>
        s.level === v.level &&
        s.verdict === v.verdict &&
        s.confidence === v.confidence &&
        s.reason === v.reason,
    )
  )
    steps.push({ level: v.level, verdict: v.verdict, confidence: v.confidence, reason: v.reason });
  return steps;
}

export const fmtProbability = (p: number) => `${Math.round(p * 100)}%`;

export function acceptanceText(a: Acceptance): string {
  switch (a.type) {
    case 'command':
    case 'test':
      return `${a.run ?? ''}${a.expectExit !== undefined && a.expectExit !== 0 ? ` (종료코드 ${a.expectExit})` : ''}`;
    case 'file_exists':
      return a.file ? `파일 존재: ${a.file}` : '산출물 존재';
    case 'symbol':
      return `심볼 ${a.symbol ?? ''}${a.file ? ` in ${a.file}` : ''}`;
    case 'schema':
      return `JSON 스키마${a.file ? ` ${a.file}` : ''}${a.requiredKeys?.length ? ` (키: ${a.requiredKeys.join(', ')})` : ''}`;
    case 'llm':
      return a.prompt ?? '';
    default:
      return JSON.stringify(a);
  }
}

// ── 36.4 승인 카드 ───────────────────────────────────────────────
export type ApprovalDecision = 'equivalent' | 'move' | 'fail';

export const APPROVAL_BUTTONS: readonly { id: ApprovalDecision; label: string }[] = [
  { id: 'equivalent', label: '동치 인정' },
  { id: 'move', label: '이동 승인' },
  { id: 'fail', label: '실패' },
];

export interface PendingApproval {
  approvalId: string;
  itemId: string;
  title: string;
  expectedPath: string;
  actualPath: string;
  reason: string;
}

/** 판정 사다리 L5 승인 요청(kind ladder.l5) 중 아직 답하지 않은 것 */
export function pendingApprovals(
  events: readonly HarnessEvent[],
  sessionId: string | undefined,
  resolved: ReadonlySet<string> = new Set(),
): PendingApproval[] {
  const out = new Map<string, PendingApproval>();
  for (const e of events) {
    if (e.type !== 'approval_request' || e.kind !== 'ladder.l5') continue;
    if (sessionId && e.sessionId !== sessionId) continue;
    if (resolved.has(e.approvalId)) continue;
    const d = e.detail ?? {};
    const expectedPath = str(d.expectedPath);
    const actualPath = str(d.actualPath);
    if (!expectedPath || !actualPath) continue;
    out.set(e.approvalId, {
      approvalId: e.approvalId,
      itemId: str(d.itemId) ?? e.itemId ?? '',
      title: e.title,
      expectedPath,
      actualPath,
      reason: str(d.reason) ?? '',
    });
  }
  return [...out.values()];
}
