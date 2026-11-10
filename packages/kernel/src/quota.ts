import type { AuthMode, EnginesSettings } from './engines-settings.js';

/**
 * T-060 쿼터 미터와 폴백 라우팅
 * - 60.1 엔진별 usage 집계: 토큰·요청 수·비용(엔진 보고값, 없으면 단가로 추정)·한도 대비 사용률
 * - 60.3 quota_exceeded → ① 같은 엔진 API 모드 → ② 폴백 엔진 → ③ 리셋 시각까지 일시정지 후 재개
 * - 60.4 엔진이 바뀌어도 체크리스트의 "다음 미완료 항목"부터 재개
 */

// ── 60.1 집계 ────────────────────────────────────────────────

/** 집계 입력 — HarnessEvent·LogRecord 모두 구조적으로 받는다 */
export interface QuotaEventLike {
  type: string;
  engineId?: string;
  ts?: string;
  inputTokens?: unknown;
  outputTokens?: unknown;
  cacheReadTokens?: unknown;
  costUsd?: unknown;
  quotaRatio?: unknown;
  code?: unknown;
}

/** 100만 토큰당 USD */
export interface EnginePricing {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadPerMTok?: number;
}

/** 사용률 계산용 한도 (엔진이 사용률을 직접 알려주지 않을 때) */
export interface EngineLimit {
  tokens?: number;
  requests?: number;
  costUsd?: number;
}

export interface QuotaOptions {
  pricing?: Record<string, EnginePricing>;
  limits?: Record<string, EngineLimit>;
}

export interface EngineUsageSummary {
  engineId: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  /** 모델 호출 수 (토큰 0인 쿼터 조회 이벤트는 세지 않는다) */
  requests: number;
  costUsd: number;
  /** 비용 일부가 단가 추정값이면 true */
  costEstimated: boolean;
  /** 한도 대비 사용률 0~1 (모르면 undefined) */
  ratio?: number;
  ratioSource?: 'engine' | 'limit' | 'quota_exceeded';
  /** quota_exceeded 오류를 받은 적 있음 */
  exceeded: boolean;
  lastTs?: string;
}

export type QuotaLevel = 'ok' | 'warning' | 'danger' | 'unknown';
export const QUOTA_WARNING_RATIO = 0.8;
export const QUOTA_DANGER_RATIO = 0.95;

/** 60.2 막대 색: 80% 이상 노랑, 95% 이상 빨강 */
export function quotaLevel(ratio: number | undefined): QuotaLevel {
  if (ratio === undefined || !Number.isFinite(ratio)) return 'unknown';
  if (ratio >= QUOTA_DANGER_RATIO) return 'danger';
  if (ratio >= QUOTA_WARNING_RATIO) return 'warning';
  return 'ok';
}

const nn = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

interface Acc {
  input: number;
  output: number;
  cache: number;
  requests: number;
  reportedCost: number;
  estimatedCost: number;
  estimated: boolean;
  engineRatio?: number;
  exceeded: boolean;
  lastTs?: string;
}

export class UsageAggregator {
  private readonly acc = new Map<string, Acc>();

  constructor(private readonly opts: QuotaOptions = {}) {}

  /** 이벤트 하나 반영 (usage·error(quota_exceeded)만 본다) */
  add(e: QuotaEventLike): void {
    if (!e.engineId || (e.type !== 'usage' && e.type !== 'error')) return;
    let a = this.acc.get(e.engineId);
    if (!a) {
      a = {
        input: 0,
        output: 0,
        cache: 0,
        requests: 0,
        reportedCost: 0,
        estimatedCost: 0,
        estimated: false,
        exceeded: false,
      };
      this.acc.set(e.engineId, a);
    }
    if (e.ts && (!a.lastTs || e.ts > a.lastTs)) a.lastTs = e.ts;
    if (e.type === 'error') {
      if (e.code === 'quota_exceeded') a.exceeded = true;
      return;
    }
    const input = nn(e.inputTokens);
    const output = nn(e.outputTokens);
    const cache = nn(e.cacheReadTokens);
    a.input += input;
    a.output += output;
    a.cache += cache;
    if (input + output + cache > 0) a.requests++;
    if (typeof e.costUsd === 'number' && Number.isFinite(e.costUsd)) a.reportedCost += nn(e.costUsd);
    else if (input + output + cache > 0) {
      const p = this.opts.pricing?.[e.engineId];
      if (p) {
        a.estimatedCost +=
          (input * p.inputPerMTok + output * p.outputPerMTok + cache * (p.cacheReadPerMTok ?? 0)) / 1e6;
        a.estimated = true;
      }
    }
    // 엔진이 보고한 사용률은 최신값 (창이 리셋되면 내려갈 수 있다)
    if (typeof e.quotaRatio === 'number' && Number.isFinite(e.quotaRatio))
      a.engineRatio = clamp01(e.quotaRatio);
  }

  addAll(events: Iterable<QuotaEventLike>): this {
    for (const e of events) this.add(e);
    return this;
  }

  summary(engineId: string): EngineUsageSummary | undefined {
    const a = this.acc.get(engineId);
    if (!a) return undefined;
    const costUsd = a.reportedCost + a.estimatedCost;
    const totalTokens = a.input + a.output + a.cache;
    let ratio: number | undefined;
    let ratioSource: EngineUsageSummary['ratioSource'];
    if (a.engineRatio !== undefined) {
      ratio = a.engineRatio;
      ratioSource = 'engine';
    } else {
      const lim = this.opts.limits?.[engineId];
      const parts: number[] = [];
      if (lim?.tokens) parts.push(totalTokens / lim.tokens);
      if (lim?.requests) parts.push(a.requests / lim.requests);
      if (lim?.costUsd) parts.push(costUsd / lim.costUsd);
      if (parts.length) {
        ratio = clamp01(Math.max(...parts));
        ratioSource = 'limit';
      }
    }
    if (a.exceeded && (ratio === undefined || ratio < 1)) {
      ratio = 1;
      ratioSource = 'quota_exceeded';
    }
    return {
      engineId,
      inputTokens: a.input,
      outputTokens: a.output,
      cacheReadTokens: a.cache,
      totalTokens,
      requests: a.requests,
      costUsd: Math.round(costUsd * 1e6) / 1e6,
      costEstimated: a.estimated,
      ...(ratio !== undefined ? { ratio, ratioSource } : {}),
      exceeded: a.exceeded,
      ...(a.lastTs ? { lastTs: a.lastTs } : {}),
    };
  }

  /** 엔진 id 순 */
  summaries(): EngineUsageSummary[] {
    return [...this.acc.keys()].sort().map((id) => this.summary(id)!);
  }
}

export function aggregateUsage(
  events: Iterable<QuotaEventLike>,
  opts: QuotaOptions = {},
): EngineUsageSummary[] {
  return new UsageAggregator(opts).addAll(events).summaries();
}

// ── 60.3 quota_exceeded 라우팅 ────────────────────────────────

export interface EngineSelection {
  engineId: string;
  mode: AuthMode;
}

export type QuotaDecision =
  | { action: 'switch-mode'; from: EngineSelection; to: EngineSelection }
  | { action: 'fallback'; from: EngineSelection; to: EngineSelection }
  | { action: 'pause'; from: EngineSelection; until?: Date };

export interface RouteContext {
  settings: EnginesSettings;
  /** 키체인에 이 엔진의 API 키가 있는지 */
  hasApiKey(engineId: string): boolean;
  /** 설치·로드돼 있는지 (기본: 모두 사용 가능) */
  available?(engineId: string): boolean;
  /** 이번 리셋 창에서 이미 한도에 걸린 선택 ("engine:mode") */
  exhausted: ReadonlySet<string>;
  /** 엔진이 알려준 리셋 시각 */
  resetAt?: Date;
}

export const selectionKey = (s: EngineSelection) => `${s.engineId}:${s.mode}`;

/**
 * quota_exceeded를 받은 현재 선택에서 다음 행동을 고른다.
 * ① 구독 모드이고 키체인에 키가 있으면 같은 엔진 API 모드
 * ② 설정의 fallback 순서대로 — 사용 가능하고, 아직 한도에 안 걸렸고, 인증 가능한(구독 또는 키 있음) 엔진
 * ③ 없으면 리셋 시각까지 일시정지
 */
export function decideOnQuotaExceeded(cur: EngineSelection, ctx: RouteContext): QuotaDecision {
  const exhausted = new Set([...ctx.exhausted, selectionKey(cur)]);
  const ok = (s: EngineSelection) =>
    !exhausted.has(selectionKey(s)) &&
    (ctx.available?.(s.engineId) ?? true) &&
    (s.mode === 'subscription' || ctx.hasApiKey(s.engineId));

  const apiMode: EngineSelection = { engineId: cur.engineId, mode: 'apiKey' };
  if (cur.mode === 'subscription' && ok(apiMode)) return { action: 'switch-mode', from: cur, to: apiMode };

  for (const f of ctx.settings.engines[cur.engineId]?.fallback ?? []) {
    const mode = ctx.settings.engines[f]?.mode ?? 'subscription';
    const candidates: EngineSelection[] = [{ engineId: f, mode }];
    // 폴백 엔진이 구독 모드인데 이미 한도면 그 엔진의 API 모드도 시도
    if (mode === 'subscription') candidates.push({ engineId: f, mode: 'apiKey' });
    const to = candidates.find(ok);
    if (to) return { action: 'fallback', from: cur, to };
  }
  return { action: 'pause', from: cur, ...(ctx.resetAt ? { until: ctx.resetAt } : {}) };
}

/** 오류 메시지에서 리셋 시각 추정: ISO 시각, "resets at <ISO>", "try again in N minutes/hours/seconds" */
export function parseResetAt(message: string, now: Date = new Date()): Date | undefined {
  const iso = /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2}))/.exec(message);
  if (iso) {
    const d = new Date(iso[1]!);
    if (!Number.isNaN(d.getTime())) return d;
  }
  const rel = /in\s+(\d+(?:\.\d+)?)\s*(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h)\b/i.exec(message);
  if (rel) {
    const n = Number(rel[1]);
    const u = rel[2]!.toLowerCase();
    const ms = u.startsWith('h') ? 3_600_000 : u.startsWith('m') ? 60_000 : 1000;
    return new Date(now.getTime() + n * ms);
  }
  return undefined;
}

// ── 60.4 체크리스트 재개 ──────────────────────────────────────

/** @harness-x/checklist-ledger의 ChecklistLedger와 구조적으로 호환 */
export interface ResumableLedger {
  currentItem(): { id: string; title?: string } | null;
  nextItems(n?: number): { id: string; title?: string }[];
}

export interface FailoverRunInput {
  selection: EngineSelection;
  item: { id: string; title?: string };
  /** 엔진에 넘길 재개 지시 */
  prompt: string;
}

export type FailoverRunResult =
  | { status: 'done' }
  | { status: 'quota_exceeded'; resetAt?: Date; message?: string }
  | { status: 'failed'; message?: string };

/** 재개 지시: 현재(미완료) 항목부터 — 끝난 항목은 다시 하지 않는다 */
export function resumePrompt(ledger: ResumableLedger): string | undefined {
  const cur = ledger.currentItem();
  if (!cur) return undefined;
  const next = ledger.nextItems(3);
  return [
    `체크리스트의 다음 미완료 항목 ${cur.id}${cur.title ? ` "${cur.title}"` : ''}부터 이어서 진행하세요.`,
    '완료(done)된 항목은 다시 하지 마세요.',
    ...(next.length ? [`그다음 항목: ${next.map((i) => i.id).join(', ')}`] : []),
  ].join('\n');
}

export interface FailoverLoopOptions {
  ledger: ResumableLedger;
  start: EngineSelection;
  route: Omit<RouteContext, 'exhausted' | 'resetAt'>;
  /** 항목 하나 실행 — 성공 시 원장 전이(done)는 실행기가 한다 */
  runItem(input: FailoverRunInput): Promise<FailoverRunResult>;
  /** 리셋 시각까지 대기 */
  sleepUntil(until: Date | undefined): Promise<void>;
  onDecision?(d: QuotaDecision): void;
  /** 무한 루프 방지 (기본 50) */
  maxSteps?: number;
}

export interface FailoverLoopResult {
  status: 'completed' | 'failed' | 'max_steps';
  decisions: QuotaDecision[];
  /** 실행 기록 (항목·엔진·결과) */
  runs: { itemId: string; selection: EngineSelection; status: FailoverRunResult['status'] }[];
}

/**
 * 체크리스트를 끝까지 실행하며 quota_exceeded면 라우팅 결정을 적용한다.
 * 매 반복마다 원장의 currentItem()을 다시 읽으므로, 엔진이 바뀌어도 다음 미완료 항목부터 재개한다.
 * 일시정지 후에는 처음 선택(start)으로 돌아가고 한도 기록을 지운다(리셋).
 */
export async function runChecklistWithFailover(o: FailoverLoopOptions): Promise<FailoverLoopResult> {
  let sel = o.start;
  const exhausted = new Set<string>();
  const decisions: QuotaDecision[] = [];
  const runs: FailoverLoopResult['runs'] = [];
  for (let step = 0; step < (o.maxSteps ?? 50); step++) {
    const item = o.ledger.currentItem();
    if (!item) return { status: 'completed', decisions, runs };
    const r = await o.runItem({ selection: sel, item, prompt: resumePrompt(o.ledger)! });
    runs.push({ itemId: item.id, selection: sel, status: r.status });
    if (r.status === 'done') continue;
    if (r.status === 'failed') return { status: 'failed', decisions, runs };
    const d = decideOnQuotaExceeded(sel, {
      ...o.route,
      exhausted,
      ...(r.resetAt ? { resetAt: r.resetAt } : {}),
    });
    decisions.push(d);
    o.onDecision?.(d);
    exhausted.add(selectionKey(sel));
    if (d.action === 'pause') {
      await o.sleepUntil(d.until);
      exhausted.clear();
      sel = o.start;
    } else sel = d.to;
  }
  return { status: 'max_steps', decisions, runs };
}
