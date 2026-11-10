import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PluginManifestSchema, type PluginManifest, type PluginManifestInput } from '@harness-x/protocol';
import { copyPlugin } from '../sandbox.js';

/** 가져온 플러그인의 진입 모듈 (원본 index.js와 겹치지 않게 별도 이름) */
export const IMPORT_MAIN = 'harness-index.js';

export interface ImportResult {
  dir: string;
  manifest: PluginManifest;
  /** 변환하지 못한 것 (사람이 읽는 문장) */
  warnings: string[];
}

export class ImportError extends Error {}

export function kebab(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/, '');
}

const SEMVER = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
export const semverOr = (v: unknown, fallback = '0.1.0') =>
  typeof v === 'string' && SEMVER.test(v) ? v : fallback;

/** 원본 폴더를 dest로 복사 (dest는 없거나 비어 있어야 함) */
export function prepareDest(src: string | undefined, dest: string): void {
  if (existsSync(dest) && readdirSync(dest).length > 0)
    throw new ImportError(`대상 폴더가 비어 있지 않음: ${dest}`);
  mkdirSync(dest, { recursive: true });
  if (src) copyPlugin(src, dest);
}

/** 매니페스트 검증 후 harness-plugin.json + 진입 모듈 쓰기 */
export function writePlugin(dest: string, manifest: PluginManifestInput, mainSource: string): PluginManifest {
  const r = PluginManifestSchema.safeParse({ ...manifest, main: IMPORT_MAIN });
  if (!r.success)
    throw new ImportError(
      `변환한 매니페스트가 스키마를 통과하지 못함: ${r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
    );
  writeFileSync(join(dest, 'harness-plugin.json'), JSON.stringify(r.data, null, 2) + '\n');
  writeFileSync(join(dest, IMPORT_MAIN), mainSource);
  return r.data;
}

/** JS 소스에 넣을 JSON 리터럴 */
export const js = (v: unknown) => JSON.stringify(v, null, 2);
