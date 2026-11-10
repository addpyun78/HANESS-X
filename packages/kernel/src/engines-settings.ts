import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { z } from 'zod';
import { harnessHome } from './loader.js';

/**
 * 13.2 엔진별 인증·모델 설정 (~/.harness-x/engines-settings.yaml)
 * 키 원문은 이 파일에 둘 수 없다(strict 스키마). apiKey 모드의 키는 OS 키체인에서 꺼낸다.
 */

export const ENGINES_SETTINGS_FILE = 'engines-settings.yaml';

export const AuthModeSchema = z.enum(['subscription', 'apiKey']);
export type AuthMode = z.infer<typeof AuthModeSchema>;

const ENGINE_ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const EngineSettingSchema = z
  .object({
    mode: AuthModeSchema,
    /** 엔진에 넘길 모델 이름 (생략 시 엔진 기본값) */
    model: z.string().min(1).optional(),
    /** 실패·한도 초과 시 넘길 엔진 id (하나 또는 순서 목록) */
    fallback: z
      .union([z.string().regex(ENGINE_ID_RE), z.array(z.string().regex(ENGINE_ID_RE))])
      .optional()
      .transform((v) => (v === undefined ? [] : Array.isArray(v) ? v : [v])),
  })
  .strict();
export type EngineSetting = z.infer<typeof EngineSettingSchema>;

export const EnginesSettingsSchema = z
  .object({
    engines: z.record(z.string().regex(ENGINE_ID_RE), EngineSettingSchema).default({}),
  })
  .strict()
  .superRefine((s, ctx) => {
    for (const [id, e] of Object.entries(s.engines)) {
      for (const f of e.fallback) {
        if (f === id)
          ctx.addIssue({
            code: 'custom',
            path: ['engines', id, 'fallback'],
            message: '자기 자신으로 fallback 불가',
          });
        else if (!(f in s.engines))
          ctx.addIssue({
            code: 'custom',
            path: ['engines', id, 'fallback'],
            message: `fallback 대상 '${f}'가 engines에 없습니다`,
          });
      }
    }
  });
export type EnginesSettings = z.infer<typeof EnginesSettingsSchema>;

export function parseEnginesSettings(yamlText: string): EnginesSettings {
  return EnginesSettingsSchema.parse(parseYaml(yamlText) ?? {});
}

export function defaultEnginesSettingsFile(): string {
  return join(harnessHome(), ENGINES_SETTINGS_FILE);
}

/** 파일이 없으면 빈 설정 */
export function loadEnginesSettings(file = defaultEnginesSettingsFile()): EnginesSettings {
  if (!existsSync(file)) return EnginesSettingsSchema.parse({});
  return parseEnginesSettings(readFileSync(file, 'utf8'));
}

/** 38.3 스키마 검증 후 원자적 기록 (임시 파일 → rename). 키 원문 필드는 strict 스키마가 거부한다 */
export function writeEnginesSettings(
  settings: z.input<typeof EnginesSettingsSchema>,
  file = defaultEnginesSettingsFile(),
): EnginesSettings {
  const parsed = EnginesSettingsSchema.parse(settings);
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, stringifyYaml(parsed));
  renameSync(tmp, file);
  return parsed;
}
