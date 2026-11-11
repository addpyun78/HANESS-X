import { z } from 'zod';

/**
 * P4-C.1 설계 AI 설정 `builder.*`
 *   builder.engine        설계에 쓸 엔진 id (감지된 엔진 중 하나). 빈 값 = 세션 기본 엔진
 *   builder.maxQuestions  되묻기 질문 최대 개수 (기본 3)
 *   builder.animation     초안 조립 애니메이션 (P4-D.2, 기본 켬)
 */

export const BUILDER_DEFAULT_MAX_QUESTIONS = 3;

export const BuilderSettingsSchema = z
  .object({
    engine: z.string().default(''),
    maxQuestions: z.number().int().min(0).max(3).default(BUILDER_DEFAULT_MAX_QUESTIONS),
    animation: z.boolean().default(true),
  })
  .strict();

export type BuilderSettings = z.infer<typeof BuilderSettingsSchema>;
export type BuilderSettingsInput = z.input<typeof BuilderSettingsSchema>;

export const DEFAULT_BUILDER_SETTINGS: BuilderSettings = BuilderSettingsSchema.parse({});

/** `{ builder: {...} }`로 감싸도 되고 안쪽 객체만 줘도 된다. 잘못된 값이면 ZodError */
export function parseBuilderSettings(input: unknown = {}): BuilderSettings {
  const inner =
    input && typeof input === 'object' && 'builder' in input
      ? (input as { builder: unknown }).builder
      : input;
  return BuilderSettingsSchema.parse(inner ?? {});
}

/** 엔진 스캐너 실행 파일 이름 → 하네스 엔진 id */
const ALIASES: Readonly<Record<string, string>> = { claude: 'claude-code', agy: 'antigravity' };
export const normalizeDesignerEngineId = (id: string): string => {
  const k = id.trim().toLowerCase();
  return ALIASES[k] ?? k;
};

export interface DesignerEngineChoice {
  /** 고른 엔진 id (없으면 undefined = 쓸 엔진이 없음) */
  engineId: string | undefined;
  /** 어디서 골랐나 */
  from: 'setting' | 'session-default' | 'none';
}

/**
 * 설계 엔진 고르기: builder.engine이 감지된 엔진이면 그것, 아니면 세션 기본 엔진.
 * (감지되지 않은 엔진 id가 설정돼 있으면 무시하고 기본 엔진을 쓴다)
 */
export function resolveDesignerEngine(
  settings: Pick<BuilderSettings, 'engine'>,
  detected: readonly string[],
  sessionDefault: string | undefined,
): DesignerEngineChoice {
  const ids = detected.map(normalizeDesignerEngineId);
  const want = settings.engine ? normalizeDesignerEngineId(settings.engine) : '';
  if (want && ids.includes(want)) return { engineId: want, from: 'setting' };
  if (sessionDefault) return { engineId: normalizeDesignerEngineId(sessionDefault), from: 'session-default' };
  return { engineId: undefined, from: 'none' };
}
