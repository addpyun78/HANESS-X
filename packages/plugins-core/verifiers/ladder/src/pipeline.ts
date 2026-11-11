import {
  buildCard,
  dictionaryMatch,
  type ApprovalCard,
  type ChoiceId,
  type DictionaryFiles,
  type DifferenceKind as CardDifferenceKind,
} from '@harness-x/approvals';
import type { CompareEvidence } from '@harness-x/checklist-ledger';
import {
  asText,
  compareEvidence,
  compareValues,
  type CompareCtx,
  type CompareOptions,
  type CompareOutcome,
  type SemanticMode,
} from '@harness-x/comparators';
import type { JudgeOutcome, JudgeRequest } from '@harness-x/judge';

/**
 * 비교 파이프라인 (T-100 최종 결정 1): 정규화 → 사전 → 의미 판단 → 사용자 승인
 *   1. 정규화: compareValues (비교기). 같으면 통과, 확실히 다르면 실패.
 *      exact · semantic: off · 자동 엄격 대상은 여기서 바로 실패 — 카드 없음 (D.3·D.4)
 *   2. 사전: 승인 카드에서 "다음부터 자동"으로 저장한 쌍(glossary.json · equivalences.json) → 통과
 *   3. 의미 판단: judge 체인 (사용자 설정 AI → 로컬 Ollama → 구독 엔진)
 *        equal(≥0.9)       → 통과 (evidence compare.level 'semantic', ai_judged) + AI 인정 횟수 기록(F.4)
 *        different(<0.6)   → 실패
 *        uncertain(0.6~0.9) → 승인 카드 (path/text/number)
 *        unavailable       → 승인 카드 (판정 AI 없음 no-judge · 상한 초과 limit-exceeded)
 *   4. 사용자 승인: 카드를 저장소에 올리고 항목은 그대로 둔다(awaiting). 사람이 버튼을 누르면 handlers가 반영한다.
 * 이 함수는 예외를 던지지 않는 judge 체인을 전제로 한다.
 */

/** judge 체인 (createJudgeChain 결과) */
export interface SemanticJudge {
  judge(req: JudgeRequest): Promise<JudgeOutcome>;
  readonly settings?: { readonly semantic: 'on' | 'off' };
}

/** 승인 카드 저장소 (createApprovalStore 결과의 add만 쓴다) */
export interface ApprovalCardSink {
  add(card: unknown): { card: ApprovalCard };
}

/** AI 인정 횟수 기록 (createAiAcceptTracker 결과) */
export interface AiAcceptRecorder {
  record(input: {
    kind: CardDifferenceKind;
    expected: string;
    actual: string;
    itemId: string;
    sessionId?: string;
    judgeEngine?: string;
  }): { count: number; proposal?: ApprovalCard };
}

export interface ComparePipelineOptions {
  /** 없거나 null이면 판정할 AI가 없는 것으로 본다 (→ no-judge 카드) */
  judge?: SemanticJudge | null;
  /** "다음부터 자동"으로 저장된 사전 */
  dictionary?: DictionaryFiles;
  /** 승인 카드를 올릴 곳 (없으면 카드는 결과에만 담는다) */
  approvals?: ApprovalCardSink;
  /** F.4 AI 인정 3회 → 사전 등록 제안 카드 */
  aiAccepts?: AiAcceptRecorder;
  sessionId?: string;
  now?: () => Date;
  idGen?: () => string;
}

export interface CompareItem {
  itemId: string;
  itemTitle?: string;
  /** 항목을 작성한 엔진 (E.7) */
  authorEngineId?: string;
  sessionId?: string;
}

export interface PipelineCompareInput extends CompareItem {
  /** 비교기 종류 또는 'auto' */
  kind: string;
  expected: unknown;
  actual: unknown;
  ctx: CompareCtx;
  options?: CompareOptions;
  semantic?: SemanticMode;
  file?: string;
}

export type PipelineStatus = 'pass' | 'fail' | 'awaiting';

export interface PipelineResult {
  /** pass 통과 · fail 실패 · awaiting 사람 승인 대기 (카드) */
  status: PipelineStatus;
  /** 최종 비교 결과 (level·verdict·confidence는 끝난 단계 기준) */
  outcome: CompareOutcome;
  /** 의미 판단 결과 (3단계까지 갔을 때) */
  judge?: JudgeOutcome;
  /** awaiting이면 승인 카드 */
  card?: ApprovalCard;
  /** F.4 사전 등록 제안 카드 (AI 인정 3회째) */
  proposal?: ApprovalCard;
  /** 의미 판단으로 통과 (F.2) */
  aiJudged: boolean;
  /** 항목 evidence에 넣을 비교 증거 (F.1) */
  evidence: CompareEvidence;
}

/** 비교기 종류 → 승인 카드·사전 종류 */
export function cardKindFor(comparatorKind: string): 'path' | 'text' | 'number' {
  if (comparatorKind === 'path') return 'path';
  if (comparatorKind === 'number' || comparatorKind === 'exitCode') return 'number';
  return 'text';
}

/** 체인이 "모르겠다"고 하면 어떤 카드로 물을지 */
export function cardKindForJudge(o: JudgeOutcome, comparatorKind: string): CardDifferenceKind {
  if (o.verdict === 'unavailable') return o.reason === 'limit' ? 'limit-exceeded' : 'no-judge';
  return cardKindFor(comparatorKind);
}

/** 같은 뜻이라고 본 표본이 더 많으면 "같은 걸로 인정"을 추천 (쉬운 말 검사를 통과해야 화면에 나온다) */
function recommendationFor(o: JudgeOutcome): ChoiceId | undefined {
  if (o.verdict !== 'uncertain') return undefined;
  if (o.differenceKind === 'equivalent' || o.differenceKind === 'formatting-only')
    return o.confidence >= 0.5 ? 'accept' : undefined;
  return undefined;
}

export function createComparePipeline(opts: ComparePipelineOptions = {}) {
  const semanticOff = opts.judge?.settings?.semantic === 'off';

  const finish = (
    status: PipelineStatus,
    outcome: CompareOutcome,
    more: Partial<Omit<PipelineResult, 'status' | 'outcome' | 'evidence' | 'aiJudged'>> = {},
  ): PipelineResult => {
    const aiJudged = outcome.level === 'semantic' && outcome.verdict === 'equal';
    const j = more.judge;
    return {
      status,
      outcome,
      ...more,
      aiJudged,
      evidence: compareEvidence(outcome, {
        ...(j?.engineId ? { judgeEngine: j.engineId } : {}),
        ...(j?.samples ? { samples: j.samples } : {}),
        ...(opts.now ? { ts: opts.now().toISOString() } : {}),
      }),
    };
  };

  /** 정규화 단계 결과(compareValues)를 받아 사전 → 의미 판단 → 승인 카드로 이어간다 */
  async function resolve(
    outcome: CompareOutcome,
    raw: { expected: unknown; actual: unknown },
    item: CompareItem,
  ): Promise<PipelineResult> {
    if (outcome.next === 'pass') return finish('pass', outcome);
    if (outcome.next === 'fail') return finish('fail', outcome);

    const expected = asText(raw.expected);
    const actual = asText(raw.actual);
    const kind = cardKindFor(outcome.kind);
    const sessionId = item.sessionId ?? opts.sessionId ?? 'default';

    // 2. 사전 ("다음부터 자동"으로 저장된 쌍)
    if (opts.dictionary) {
      const hit =
        dictionaryMatch(opts.dictionary, { kind, expected, actual }) ??
        dictionaryMatch(opts.dictionary, {
          kind,
          expected: outcome.normalizedExpected,
          actual: outcome.normalizedActual,
        });
      if (hit)
        return finish('pass', {
          ...outcome,
          verdict: 'equal',
          level: 'dictionary',
          confidence: 1,
          reason: `사전(${hit.source === 'glossary' ? 'glossary.json' : 'equivalences.json'})에 등록된 같은 쌍`,
          next: 'pass',
        });
    }

    // 3. 의미 판단
    const j: JudgeOutcome = opts.judge
      ? await opts.judge.judge({
          kind: outcome.kind,
          expected,
          actual,
          itemTitle: item.itemTitle ?? item.itemId,
          sessionId,
          ...(item.authorEngineId ? { authorEngineId: item.authorEngineId } : {}),
        })
      : { verdict: 'unavailable', confidence: 0, reason: 'no-judge' };

    const tag = `${j.engineId ?? '판정 AI 없음'}: ${j.reason}`;
    if (j.verdict === 'equal') {
      const passed: CompareOutcome = {
        ...outcome,
        verdict: 'equal',
        level: 'semantic',
        confidence: j.confidence,
        reason: `의미 판단으로 같은 뜻 (${j.confidence.toFixed(2)}) — ${tag}`,
        next: 'pass',
      };
      const rec = opts.aiAccepts?.record({
        kind,
        expected,
        actual,
        itemId: item.itemId,
        sessionId,
        ...(j.engineId ? { judgeEngine: j.engineId } : {}),
      });
      const proposal = rec?.proposal ? (opts.approvals?.add(rec.proposal).card ?? rec.proposal) : undefined;
      return finish('pass', passed, { judge: j, ...(proposal ? { proposal } : {}) });
    }
    if (j.verdict === 'different') {
      return finish(
        'fail',
        {
          ...outcome,
          verdict: 'different',
          level: 'semantic',
          confidence: Math.max(0, Math.min(1, 1 - j.confidence)),
          reason: `의미 판단으로 다른 뜻 (${j.confidence.toFixed(2)}) — ${tag}`,
          next: 'fail',
        },
        { judge: j },
      );
    }

    // 4. 사용자 승인 (uncertain · unavailable)
    const cardKind = cardKindForJudge(j, outcome.kind);
    const recommendation = recommendationFor(j);
    const card = buildCard({
      kind: cardKind,
      itemId: item.itemId,
      sessionId,
      expected,
      actual,
      comparator: outcome.kind,
      ...(j.verdict === 'uncertain' ? { confidence: j.confidence } : {}),
      ...(j.engineId ? { judgeEngine: j.engineId } : {}),
      ...(recommendation && j.plainReason ? { recommendation, plainReason: j.plainReason } : {}),
      ...(opts.idGen ? { id: opts.idGen() } : {}),
      ...(opts.now ? { now: opts.now() } : {}),
    });
    const stored = opts.approvals ? opts.approvals.add(card).card : card;
    return finish(
      'awaiting',
      {
        ...outcome,
        verdict: 'uncertain',
        level: 'human',
        confidence: j.confidence,
        reason: `사용자 승인 대기 (${cardKind}) — ${tag}`,
        next: 'semantic',
      },
      { judge: j, card: stored },
    );
  }

  return {
    /** 전체 단계 */
    async compare(input: PipelineCompareInput): Promise<PipelineResult> {
      const outcome = compareValues(input.kind, input.expected, input.actual, input.ctx, {
        ...(input.options ? { options: input.options } : {}),
        ...(semanticOff ? { semantic: 'off' } : input.semantic ? { semantic: input.semantic } : {}),
        ...(input.file ? { file: input.file } : {}),
      });
      return resolve(outcome, { expected: input.expected, actual: input.actual }, input);
    },
    resolve,
  };
}

export type ComparePipeline = ReturnType<typeof createComparePipeline>;
