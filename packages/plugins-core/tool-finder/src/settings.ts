import { z } from 'zod';
import { ToolBudgetSchema } from './need.js';

/**
 * P3-A.4 설정 `tools.*`
 *   tools.budget   free-only | free-first(기본) | any
 *   tools.searxng  로컬 SearXNG 주소 (빈 값 = 끔)
 *   tools.brave    Brave Search 사용 여부 (키는 키체인 `brave-search`에만)
 * P3-A.5 `assist.engine` 필요 도구 판단 AI (빈 값 = judge.engine → 세션 엔진)
 */

export const ToolsSettingsSchema = z
  .object({
    budget: ToolBudgetSchema.default('free-first'),
    searxng: z.string().default(''),
    brave: z.boolean().default(false),
  })
  .strict();
export type ToolsSettings = z.infer<typeof ToolsSettingsSchema>;

export const AssistSettingsSchema = z
  .object({
    engine: z.string().default(''),
    model: z.string().default(''),
  })
  .strict();
export type AssistSettings = z.infer<typeof AssistSettingsSchema>;

export const DEFAULT_TOOLS_SETTINGS: ToolsSettings = ToolsSettingsSchema.parse({});

/** `{ tools: {...} }`로 감싸도 되고 안쪽만 줘도 된다. 잘못된 값이면 ZodError */
export function parseToolsSettings(input: unknown = {}): ToolsSettings {
  const inner =
    input && typeof input === 'object' && 'tools' in input ? (input as { tools: unknown }).tools : input;
  return ToolsSettingsSchema.parse(inner ?? {});
}

export function parseAssistSettings(input: unknown = {}): AssistSettings {
  const inner =
    input && typeof input === 'object' && 'assist' in input ? (input as { assist: unknown }).assist : input;
  return AssistSettingsSchema.parse(inner ?? {});
}
