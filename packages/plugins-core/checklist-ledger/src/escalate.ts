import type { ChatMessage, ModelClient } from '@harness-x/kernel';
import {
  buildJudgeMessages,
  deviationKindQuestion,
  extractJsonObject,
  minimizeJudgeState,
  parseJudgeAnswer,
  sameArtifactQuestion,
  type ChoiceAnswer,
  type DeviationKind,
  type JudgeAnswerFor,
  type JudgeQuestion,
  type JudgeState,
  type NoulAnswer,
} from '@harness-x/protocol';

/**
 * 판정 사다리 L5 — 상위 검증 (T-027)
 * L4가 확정하지 못한 경우(0.6 ≤ p < 0.9, 판정기 off·오류)를 받는다.
 *   1) 작성 엔진과 "다른" 엔진에 L4와 같은 질문 2개를 JSON 응답 강제로 묻는다 (27.1)
 *   2) 그래도 불확실하면 approval_request(승인 카드)를 남기고 사람의 답을 기다린다 (27.2)
 *   3) POST /api/approvals/:id {equivalent|move|fail} → 항목 상태 변경 (27.3)
 *   4) 동치 인정 → glossary·manifest 별칭 자동 추가 (27.4), 이동 승인 → manifest 경로·참조 항목 갱신 (27.5)
 */

// ── 판정 대상 ─────────────────────────────────────────────────────
export interface EscalationCase {
  itemId: string;
  artifactId: string;
  itemTitle: string;
  /** 기대(정식) 경로 */
  expectedPath: string;
  /** 실제로 쓰인 경로 */
  actualPath: string;
  /** 하위 칸(L3·L4)의 판정 근거 */
  reason: string;
  /** 산출물을 쓴 엔진 — L5는 이 엔진에 묻지 않는다 */
  writerEngineId?: string;
  symbols?: string[];
  candidates?: string[];
}

// ── 27.1 다른 엔진에 같은 질문 ─────────────────────────────────────
/** 엔진 → ModelClient 생성기 (주입). 커널 엔진 설정·어댑터에서 만든다 */
export interface EngineClientFactory {
  /** 사용할 수 있는 엔진 ID (우선순위 순) */
  engineIds(): readonly string[];
  client(engineId: string): ModelClient;
}

export interface EscalationThresholds {
  accept: number;
  fail: number;
}
export const DEFAULT_ESCALATION_THRESHOLDS: Readonly<EscalationThresholds> = Object.freeze({
  accept: 0.9,
  fail: 0.6,
});

export type L5Decision = 'accept' | 'escalate' | 'fail';

/** L4와 같은 규칙: p < fail → 실패, p ≥ accept 이고 동치/허용 이동 → 인정, 그 밖은 사람에게 */
export function decideL5(
  p: number,
  kind: DeviationKind,
  t: EscalationThresholds = DEFAULT_ESCALATION_THRESHOLDS,
): L5Decision {
  if (p < t.fail) return 'fail';
  if (p >= t.accept && (kind === 'equivalent' || kind === 'relocated-ok')) return 'accept';
  return 'escalate';
}

/** JSON 응답 강제 지시 (엔진은 생성형 LLM이므로 system에 덧붙인다) */
export const FORCE_JSON_INSTRUCTION =
  'Respond with ONLY one JSON object that matches answerSchema. No prose, no markdown, no code fences.';

export interface OtherEngineAnswer {
  /** 질문한 엔진 (없으면 null — 다른 엔진이 없음) */
  engineId: string | null;
  decision: L5Decision;
  deviation?: DeviationKind;
  answers?: { sameArtifact: NoulAnswer; deviationKind: ChoiceAnswer };
  reason: string;
}

export function escalationState(c: EscalationCase): JudgeState {
  return minimizeJudgeState({
    itemTitle: c.itemTitle,
    expectedPath: c.expectedPath,
    actualPath: c.actualPath,
    candidates: c.candidates ?? [],
    fileNames: [c.expectedPath, c.actualPath].map((p) => p.split('/').filter(Boolean).pop() ?? p),
    symbols: c.symbols ?? [],
  });
}

/** 작성 엔진이 아닌 첫 엔진 */
export function pickOtherEngine(ids: readonly string[], writerEngineId?: string): string | null {
  return ids.find((id) => id !== writerEngineId) ?? null;
}

async function askJson<Q extends JudgeQuestion>(
  client: ModelClient,
  q: Q,
  state: JudgeState,
  signal?: AbortSignal,
): Promise<JudgeAnswerFor<Q>> {
  const m = buildJudgeMessages(q, state);
  const messages: ChatMessage[] = [
    { role: 'system', content: `${m.system}\n${FORCE_JSON_INSTRUCTION}` },
    { role: 'user', content: m.user },
  ];
  let lastErr: unknown;
  // 형식이 틀리면 한 번 더 요구한다
  for (let attempt = 0; attempt < 2; attempt++) {
    const turn = await client.complete({ messages, tools: [], ...(signal ? { signal } : {}) });
    try {
      return parseJudgeAnswer(q, extractJsonObject(turn.text));
    } catch (err) {
      lastErr = err;
      messages.push(
        { role: 'assistant', content: turn.text },
        { role: 'user', content: `Invalid answer. ${FORCE_JSON_INSTRUCTION}` },
      );
    }
  }
  throw lastErr;
}

/** 27.1 L5 상위 검증: 다른 엔진에 same_artifact·deviation_kind를 묻는다 */
export async function askOtherEngine(
  c: EscalationCase,
  opts: { engines: EngineClientFactory; thresholds?: EscalationThresholds; signal?: AbortSignal },
): Promise<OtherEngineAnswer> {
  const engineId = pickOtherEngine(opts.engines.engineIds(), c.writerEngineId);
  if (!engineId)
    return { engineId: null, decision: 'escalate', reason: '작성 엔진과 다른 엔진이 없어 사람에게 묻는다' };
  const client = opts.engines.client(engineId);
  const state = escalationState(c);
  let same: NoulAnswer;
  let dev: ChoiceAnswer;
  try {
    same = await askJson(client, sameArtifactQuestion(), state, opts.signal);
    dev = await askJson(client, deviationKindQuestion(), state, opts.signal);
  } catch (err) {
    return {
      engineId,
      decision: 'escalate',
      reason: `엔진 ${engineId} 판정 실패 → 사람: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const deviation = dev.choice as DeviationKind;
  const decision = decideL5(same.noul, deviation, opts.thresholds);
  return {
    engineId,
    decision,
    deviation,
    answers: { sameArtifact: same, deviationKind: dev },
    reason: `L5 ${engineId}: same_artifact=${same.noul}, deviation_kind=${deviation}(${dev.confidence}) → ${decision}`,
  };
}
