import { z } from 'zod';

/**
 * 판정기(verifier 슬롯) 인터페이스 (T-026)
 * 판정 사다리 L4(Jev·로컬 LLM)와 L5(다른 엔진)가 같은 질문 형식을 쓴다.
 *   judge(question, state) → { noul | choice | score, confidence }
 * - noul: yes/no 확률(0~1, "yes"일 확률)
 * - choice: 선택지 중 하나
 * - score: 점수(질문의 min~max)
 * state는 메타데이터(경로·파일명·심볼 목록·항목 제목)만 담는다 — 소스 본문 금지(26.4).
 */

export const JUDGE_KINDS = ['noul', 'choice', 'score'] as const;
export type JudgeKind = (typeof JUDGE_KINDS)[number];

const QuestionBase = z.object({
  /** 질문 템플릿 ID (예: same_artifact) */
  id: z.string().min(1),
  /** 판정기에게 보이는 질문 문장 */
  prompt: z.string().min(1),
});

export const NoulQuestionSchema = QuestionBase.extend({ kind: z.literal('noul') }).strict();
export const ChoiceQuestionSchema = QuestionBase.extend({
  kind: z.literal('choice'),
  choices: z.array(z.string().min(1)).min(2),
}).strict();
export const ScoreQuestionSchema = QuestionBase.extend({
  kind: z.literal('score'),
  min: z.number().default(0),
  max: z.number().default(1),
}).strict();

export const JudgeQuestionSchema = z.discriminatedUnion('kind', [
  NoulQuestionSchema,
  ChoiceQuestionSchema,
  ScoreQuestionSchema,
]);
export type NoulQuestion = z.infer<typeof NoulQuestionSchema>;
export type ChoiceQuestion = z.infer<typeof ChoiceQuestionSchema>;
export type ScoreQuestion = z.infer<typeof ScoreQuestionSchema>;
export type JudgeQuestion = z.infer<typeof JudgeQuestionSchema>;

// ── 판정 대상 상태 (메타데이터만) ─────────────────────────────────
/** 한 줄 메타데이터 문자열: 줄바꿈·백틱 금지 (코드 조각이 끼어들 틈을 없앤다) */
const MetaString = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((s) => !/[\r\n`]/.test(s), { message: '메타데이터에는 줄바꿈·백틱을 넣을 수 없습니다' });

/** 심볼 이름 (식별자·경로형 이름만) */
export const SymbolNameSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[\p{L}\p{N}_$.:#@/<>-]+$/u, { message: '심볼은 식별자 형태만 허용됩니다' });

export const JudgeStateSchema = z
  .object({
    /** 체크리스트 항목 제목 */
    itemTitle: MetaString(200),
    /** 기대(정식) 경로 */
    expectedPath: MetaString(512),
    /** 실제로 쓰인 경로 (L3 후보) */
    actualPath: MetaString(512).optional(),
    /** 그 밖의 후보 경로 */
    candidates: z.array(MetaString(512)).max(10).default([]),
    /** 관련 파일명 (basename) */
    fileNames: z.array(MetaString(255)).max(50).default([]),
    /** 관련 심볼 목록 */
    symbols: z.array(SymbolNameSchema).max(50).default([]),
  })
  .strict();
export type JudgeState = z.infer<typeof JudgeStateSchema>;
export type JudgeStateInput = z.input<typeof JudgeStateSchema>;

// ── 답 ────────────────────────────────────────────────────────────
const Prob = z.number().min(0).max(1);
export const NoulAnswerSchema = z.object({ noul: Prob, confidence: Prob }).strict();
export const ChoiceAnswerSchema = z.object({ choice: z.string().min(1), confidence: Prob }).strict();
export const ScoreAnswerSchema = z.object({ score: z.number(), confidence: Prob }).strict();
export type NoulAnswer = z.infer<typeof NoulAnswerSchema>;
export type ChoiceAnswer = z.infer<typeof ChoiceAnswerSchema>;
export type ScoreAnswer = z.infer<typeof ScoreAnswerSchema>;
export type JudgeAnswer = NoulAnswer | ChoiceAnswer | ScoreAnswer;

/** 질문 종류 → 답 타입 */
export type JudgeAnswerFor<Q extends JudgeQuestion> = Q extends { kind: 'noul' }
  ? NoulAnswer
  : Q extends { kind: 'choice' }
    ? ChoiceAnswer
    : ScoreAnswer;

export interface JudgeOptions {
  signal?: AbortSignal;
}

/** verifier 슬롯 플러그인이 구현하는 판정기 */
export interface Verifier {
  /** 판정기 ID (예: jev, local) */
  readonly id: string;
  judge<Q extends JudgeQuestion>(
    question: Q,
    state: JudgeState,
    opts?: JudgeOptions,
  ): Promise<JudgeAnswerFor<Q>>;
}

export class JudgeAnswerError extends Error {
  readonly code = 'JUDGE_ANSWER_INVALID';
  constructor(
    message: string,
    readonly raw?: unknown,
  ) {
    super(message);
    this.name = 'JudgeAnswerError';
  }
}

/** 판정기 원답(JSON) → 질문 종류에 맞는 답. 선택지 밖·범위 밖이면 JudgeAnswerError */
export function parseJudgeAnswer<Q extends JudgeQuestion>(question: Q, raw: unknown): JudgeAnswerFor<Q> {
  const fail = (m: string): never => {
    throw new JudgeAnswerError(`${question.id}: ${m}`, raw);
  };
  if (question.kind === 'noul') {
    const r = NoulAnswerSchema.safeParse(raw);
    if (!r.success) fail(`noul 답 형식 오류 — ${r.error.issues[0]?.message ?? ''}`);
    return r.data as JudgeAnswerFor<Q>;
  }
  if (question.kind === 'choice') {
    const r = ChoiceAnswerSchema.safeParse(raw);
    if (!r.success) fail(`choice 답 형식 오류 — ${r.error.issues[0]?.message ?? ''}`);
    if (!question.choices.includes(r.data!.choice)) fail(`선택지 밖의 답: ${r.data!.choice}`);
    return r.data as JudgeAnswerFor<Q>;
  }
  const r = ScoreAnswerSchema.safeParse(raw);
  if (!r.success) fail(`score 답 형식 오류 — ${r.error.issues[0]?.message ?? ''}`);
  if (r.data!.score < question.min || r.data!.score > question.max)
    fail(`점수 범위 밖: ${r.data!.score} (${question.min}~${question.max})`);
  return r.data as JudgeAnswerFor<Q>;
}

/** 답의 JSON Schema (OpenAI json_schema 응답 형식·Ollama format에 그대로 쓴다) */
export function judgeAnswerJsonSchema(question: JudgeQuestion): Record<string, unknown> {
  const confidence = { type: 'number', minimum: 0, maximum: 1 };
  const value =
    question.kind === 'noul'
      ? { type: 'number', minimum: 0, maximum: 1 }
      : question.kind === 'choice'
        ? { type: 'string', enum: [...question.choices] }
        : { type: 'number', minimum: question.min, maximum: question.max };
  return {
    type: 'object',
    properties: { [question.kind]: value, confidence },
    required: [question.kind, 'confidence'],
    additionalProperties: false,
  };
}

// ── 26.4 전송 데이터 최소화 ──────────────────────────────────────────
export class DataMinimizationError extends Error {
  readonly code = 'JUDGE_DATA_NOT_MINIMAL';
  constructor(message: string) {
    super(message);
    this.name = 'DataMinimizationError';
  }
}

/** 코드 블록(``` 울타리·~~~ 울타리·인라인 `코드`)을 지우고 공백을 한 줄로 접는다 */
export function stripCodeBlocks(text: string): string {
  return text
    .replace(/(```|~~~)[\s\S]*?(\1|$)/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/`/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function metaPath(field: string, v: unknown): string {
  if (typeof v !== 'string' || v.trim() === '') throw new DataMinimizationError(`${field}: 경로 문자열 필요`);
  if (/[\r\n`]/.test(v) || v.length > 512)
    throw new DataMinimizationError(`${field}: 경로가 아닌 값(줄바꿈·백틱·코드)은 보낼 수 없습니다`);
  return v;
}

function baseName(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

/**
 * 판정기로 보낼 상태를 최소화한다 (26.4). 허용 필드(항목 제목·경로·파일명·심볼 목록) 밖의 필드
 * (source·content·diff 등)는 버리고, 제목의 코드 블록은 지우고, 경로에 코드가 섞이면 거부하고,
 * 파일명은 basename만, 심볼은 식별자 형태만 남긴다. 결과는 JudgeStateSchema를 통과한다.
 */
export function minimizeJudgeState(input: Record<string, unknown> | JudgeState): JudgeState {
  const i = input as Record<string, unknown>;
  const title = stripCodeBlocks(typeof i.itemTitle === 'string' ? i.itemTitle : '')
    .slice(0, 200)
    .trim();
  if (!title) throw new DataMinimizationError('itemTitle이 비었습니다');
  const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
  const uniq = <T>(xs: T[]) => [...new Set(xs)];
  const fileNames = uniq(
    list(i.fileNames)
      .filter((f): f is string => typeof f === 'string' && !/[\r\n`]/.test(f))
      .map(baseName)
      .filter((f) => f.length > 0 && f.length <= 255),
  ).slice(0, 50);
  const symbols = uniq(
    list(i.symbols).filter(
      (s): s is string => typeof s === 'string' && SymbolNameSchema.safeParse(s).success,
    ),
  ).slice(0, 50);
  return JudgeStateSchema.parse({
    itemTitle: title,
    expectedPath: metaPath('expectedPath', i.expectedPath),
    ...(i.actualPath !== undefined ? { actualPath: metaPath('actualPath', i.actualPath) } : {}),
    candidates: list(i.candidates)
      .slice(0, 10)
      .map((c, k) => metaPath(`candidates[${k}]`, c)),
    fileNames,
    symbols,
  });
}

// ── 공통 요청 형식 (Jev·로컬 LLM·L5 엔진이 같은 질문 형식을 쓴다) ─────────
export const JUDGE_SYSTEM_PROMPT =
  'You are a strict verification judge for a coding harness. You receive ONE typed question and metadata ' +
  '(paths, file names, symbol names, checklist item title) — never source code. Answer ONLY with a JSON object ' +
  'matching the given schema: the answer field named after the question kind ("noul" = probability 0..1 that the ' +
  'answer is yes, "choice" = one of the choices, "score" = number in range) and "confidence" (0..1).';

export interface JudgeMessages {
  system: string;
  user: string;
}

/** 질문 + 상태 → system/user 메시지. 상태는 항상 최소화(26.4)를 거친다. user는 결정적 JSON(키 순서 고정) */
export function buildJudgeMessages(
  question: JudgeQuestion,
  state: JudgeState | Record<string, unknown>,
): JudgeMessages {
  const q: Record<string, unknown> = { id: question.id, kind: question.kind, prompt: question.prompt };
  if (question.kind === 'choice') q.choices = question.choices;
  if (question.kind === 'score') Object.assign(q, { min: question.min, max: question.max });
  const s = minimizeJudgeState(state);
  return {
    system: JUDGE_SYSTEM_PROMPT,
    user: JSON.stringify({ question: q, state: s, answerSchema: judgeAnswerJsonSchema(question) }),
  };
}

/** 모델 텍스트 답에서 JSON 객체 하나를 꺼낸다 (```json 울타리·앞뒤 설명 허용). 없으면 JudgeAnswerError */
export function extractJsonObject(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = (fenced ? fenced[1]! : text).trim();
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end < start) throw new JudgeAnswerError('JSON 객체가 없는 답', text);
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    throw new JudgeAnswerError('JSON 파싱 실패', text);
  }
}

// ── 26.3 질문 템플릿 2종 ─────────────────────────────────────────────
export const DEVIATION_KINDS = ['equivalent', 'relocated-ok', 'wrong-target', 'missing'] as const;
export type DeviationKind = (typeof DEVIATION_KINDS)[number];

/** same_artifact (noul): 실제 경로가 기대 경로와 같은 산출물인가 */
export function sameArtifactQuestion(): NoulQuestion {
  return {
    kind: 'noul',
    id: 'same_artifact',
    prompt:
      'Is the artifact at state.actualPath the same deliverable the checklist item expects at ' +
      'state.expectedPath (same purpose, only named or placed differently)? Judge from the item title, ' +
      'paths, file names and symbol names only.',
  };
}

/** deviation_kind (choice): 어긋남 종류 — 동치 / 허용 가능한 이동 / 잘못된 대상 / 누락 */
export function deviationKindQuestion(): ChoiceQuestion {
  return {
    kind: 'choice',
    id: 'deviation_kind',
    prompt:
      'Classify how state.actualPath deviates from state.expectedPath: "equivalent" = same location under ' +
      'another name (translation, synonym, naming style), "relocated-ok" = the same artifact moved to an ' +
      'acceptable other folder, "wrong-target" = a different artifact or an unacceptable place, ' +
      '"missing" = the expected artifact was not produced.',
    choices: [...DEVIATION_KINDS],
  };
}
