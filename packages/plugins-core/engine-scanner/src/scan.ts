import { defaultExec, type ExecFn } from './exec.js';
import { compareToMinimum } from './min-versions.js';
import { ENGINE_TARGETS } from './targets.js';
import { getVersion } from './version.js';
import { locateAll } from './which.js';
import type { EngineEntry, EngineLocation } from './cache.js';

export interface PathScanOptions {
  targets?: readonly string[];
  platform?: NodeJS.Platform;
  exec?: ExecFn;
  versionTimeoutMs?: number;
}

export function hostLocation(platform: NodeJS.Platform = process.platform): EngineLocation {
  if (platform === 'win32') return 'windows';
  if (platform === 'darwin') return 'macos';
  return 'linux';
}

/** 실행 파일 경로 하나 → 버전 확인 + 최소 버전 비교 */
export async function inspectEngine(
  name: string,
  path: string,
  location: EngineLocation,
  opts: { exec?: ExecFn; versionTimeoutMs?: number; versionArgs?: { file: string; args: string[] } } = {},
): Promise<EngineEntry> {
  const exec = opts.exec ?? defaultExec;
  const v = opts.versionArgs
    ? await getVersion(opts.versionArgs.file, {
        exec,
        timeoutMs: opts.versionTimeoutMs,
        args: opts.versionArgs.args,
      })
    : await getVersion(path, { exec, timeoutMs: opts.versionTimeoutMs });
  const cmp = compareToMinimum(name, v.version);
  return {
    name,
    location,
    path,
    version: v.version,
    ...(v.raw ? { versionRaw: v.raw } : {}),
    ...(cmp.minVersion ? { minVersion: cmp.minVersion } : {}),
    status: cmp.status,
    ...(v.error ? { error: v.error } : {}),
  };
}

/** 10.2–10.4: 호스트 PATH에서 대상 CLI 탐지 + 버전 확인 */
export async function scanPathEngines(opts: PathScanOptions = {}): Promise<EngineEntry[]> {
  const platform = opts.platform ?? process.platform;
  const exec = opts.exec ?? defaultExec;
  const found = await locateAll(opts.targets ?? ENGINE_TARGETS, { platform, exec });
  const location = hostLocation(platform);
  return Promise.all(
    [...found].map(([name, path]) =>
      inspectEngine(name, path, location, { exec, versionTimeoutMs: opts.versionTimeoutMs }),
    ),
  );
}
