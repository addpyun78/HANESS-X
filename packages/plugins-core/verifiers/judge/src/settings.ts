import { z } from 'zod';

/**
 * E.1 판정 설정 `judge.*` (구 `verifier.l4` 대체).
 *   judge.engine            감지된 엔진 id, 빈 값 = 자동
 *   judge.model             judge.engine에 쓸 모델 (빈 값 = 엔진 기본)
 *   judge.samples           1~3, 기본 3
 *   judge.maxCallsPerSession 기본 50
 *   judge.semantic          on | off
 *   judge.local.model       로컬 Ollama 모델 (빈 값 = 자동)
 *   judge.local.timeoutMs   기본 20000
 */

export const JUDGE_DEFAULT_SAMPLES = 3;
export const JUDGE_DEFAULT_MAX_CALLS_PER_SESSION = 50;
export const JUDGE_DEFAULT_LOCAL_TIMEOUT_MS = 20_000;

export const JudgeLocalSettingsSchema = z
  .object({
    model: z.string().default(''),
    timeoutMs: z.number().int().min(1000).max(600_000).default(JUDGE_DEFAULT_LOCAL_TIMEOUT_MS),
  })
  .strict();

export const JudgeSettingsSchema = z
  .object({
    engine: z.string().default(''),
    model: z.string().default(''),
    samples: z.number().int().min(1).max(3).default(JUDGE_DEFAULT_SAMPLES),
    maxCallsPerSession: z.number().int().min(0).default(JUDGE_DEFAULT_MAX_CALLS_PER_SESSION),
    semantic: z.enum(['on', 'off']).default('on'),
    local: JudgeLocalSettingsSchema.prefault({}),
  })
  .strict();

export type JudgeSettings = z.infer<typeof JudgeSettingsSchema>;
export type JudgeSettingsInput = z.input<typeof JudgeSettingsSchema>;

export const DEFAULT_JUDGE_SETTINGS: JudgeSettings = JudgeSettingsSchema.parse({});

/** `{ judge: {...} }`로 감싸서 줘도 되고 안쪽 객체만 줘도 된다. 잘못된 값이면 ZodError */
export function parseJudgeSettings(input: unknown = {}): JudgeSettings {
  const inner =
    input && typeof input === 'object' && 'judge' in input ? (input as { judge: unknown }).judge : input;
  return JudgeSettingsSchema.parse(inner ?? {});
}
