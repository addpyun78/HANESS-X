import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { harnessHome } from '@harness-x/kernel';

/** 10.5 탐지 결과 캐시 (~/.harness-x/engines.json) */

export const ENGINES_CACHE_VERSION = 1;

/** windows | linux | macos | wsl:<배포판> */
export const EngineLocationSchema = z.union([
  z.enum(['windows', 'linux', 'macos']),
  z.string().regex(/^wsl:[^\s]+$/),
]);
export type EngineLocation = z.infer<typeof EngineLocationSchema>;

export const EngineEntrySchema = z
  .object({
    name: z.string().min(1),
    location: EngineLocationSchema,
    path: z.string().min(1),
    version: z.string().nullable(),
    versionRaw: z.string().optional(),
    minVersion: z.string().optional(),
    status: z.enum(['ok', 'outdated', 'unknown']),
    error: z.string().optional(),
  })
  .strict();
export type EngineEntry = z.infer<typeof EngineEntrySchema>;

export const LocalLlmEntrySchema = z
  .object({
    /** ollama | lmstudio | llamacpp | vllm | jan */
    name: z.string().min(1),
    baseUrl: z.string().url(),
    /** 'ollama' = /api/tags, 'openai' = /v1/models */
    api: z.enum(['ollama', 'openai']),
    models: z.array(z.string()),
  })
  .strict();
export type LocalLlmEntry = z.infer<typeof LocalLlmEntrySchema>;

export const EnginesCacheSchema = z
  .object({
    version: z.literal(ENGINES_CACHE_VERSION),
    scannedAt: z.iso.datetime(),
    platform: z.string(),
    engines: z.array(EngineEntrySchema),
    localLlms: z.array(LocalLlmEntrySchema).default([]),
  })
  .strict();
export type EnginesCache = z.infer<typeof EnginesCacheSchema>;
export type EnginesCacheInput = z.input<typeof EnginesCacheSchema>;

export function defaultEnginesCacheFile(): string {
  return join(harnessHome(), 'engines.json');
}

/** 스키마 검증 후 원자적으로 기록 (임시 파일 → rename) */
export function writeEnginesCache(cache: EnginesCacheInput, file = defaultEnginesCacheFile()): EnginesCache {
  const parsed = EnginesCacheSchema.parse(cache);
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(parsed, null, 2) + '\n');
  renameSync(tmp, file);
  return parsed;
}

/** 캐시 읽기. 없거나 스키마 불일치면 null */
export function readEnginesCache(file = defaultEnginesCacheFile()): EnginesCache | null {
  if (!existsSync(file)) return null;
  try {
    const r = EnginesCacheSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}
