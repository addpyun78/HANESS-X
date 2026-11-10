import { posix } from 'node:path';
import { defaultExec, outputLines, type ExecFn } from './exec.js';
import { inspectEngine, scanPathEngines, type PathScanOptions } from './scan.js';
import type { EngineEntry } from './cache.js';

/**
 * T-011 WSL 탐지 (Windows 호스트에서만).
 * wsl.exe -l -q 는 UTF-16LE로 출력하고, wsl -e 로 실행한 리눅스 명령의 출력은 UTF-8 그대로 온다.
 */

export const WSL_EXE = 'wsl.exe';
/** 11.2 기본 확인 대상 */
export const WSL_TARGETS = ['claude', 'codex', 'agy'] as const;
/** 셸이 없어 확인할 수 없는 내부 배포판 */
const INTERNAL_DISTROS = new Set(['docker-desktop', 'docker-desktop-data']);

/** 11.1 wsl -l -q 출력 디코딩 (UTF-16LE, BOM·NUL·CRLF 처리). UTF-8로 와도 처리한다 */
export function decodeWslOutput(buf: Buffer): string {
  let b = buf;
  const hasBom = b.length >= 2 && b[0] === 0xff && b[1] === 0xfe;
  // UTF-16LE 추정: BOM이 있거나 홀수 바이트에 NUL이 많음
  let nulOdd = 0;
  for (let i = 1; i < b.length; i += 2) if (b[i] === 0) nulOdd++;
  const utf16 = hasBom || (b.length >= 2 && nulOdd >= Math.floor(b.length / 2) * 0.5);
  if (hasBom) b = b.subarray(2);
  const text = utf16 ? b.toString('utf16le') : b.toString('utf8');
  const noBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  return noBom.replace(/\0/g, '');
}

export function parseWslDistros(buf: Buffer, opts: { includeInternal?: boolean } = {}): string[] {
  const names = outputLines(decodeWslOutput(buf));
  return opts.includeInternal ? names : names.filter((n) => !INTERNAL_DISTROS.has(n.toLowerCase()));
}

export interface WslOptions {
  exec?: ExecFn;
  wslExe?: string;
  timeoutMs?: number;
  versionTimeoutMs?: number;
  targets?: readonly string[];
}

export async function listWslDistros(opts: WslOptions = {}): Promise<string[]> {
  const exec = opts.exec ?? defaultExec;
  const r = await exec(opts.wslExe ?? WSL_EXE, ['-l', '-q'], { timeoutMs: opts.timeoutMs ?? 10_000 });
  if (r.code !== 0) return [];
  return parseWslDistros(r.stdout);
}

/**
 * 배포판 안에서 실행할 확인 스크립트.
 * POSIX sh(dash)의 `command -v a b c`는 첫 이름만 확인하므로(실제 Ubuntu에서 claude만 출력됨) 이름마다 반복한다.
 */
export function wslLookupScript(targets: readonly string[]): string {
  for (const t of targets) if (!/^[a-z0-9][a-z0-9-]*$/.test(t)) throw new Error(`잘못된 CLI 이름: ${t}`);
  return `for c in ${targets.join(' ')}; do command -v "$c"; done; exit 0`;
}

/** 11.2 배포판 안에서 command -v 로 CLI 경로 확인 → location: wsl:<배포판> */
export async function scanWslDistro(distro: string, opts: WslOptions = {}): Promise<EngineEntry[]> {
  const exec = opts.exec ?? defaultExec;
  const wsl = opts.wslExe ?? WSL_EXE;
  const targets = opts.targets ?? WSL_TARGETS;
  const r = await exec(wsl, ['-d', distro, '-e', 'sh', '-lc', wslLookupScript(targets)], {
    timeoutMs: opts.timeoutMs ?? 15_000,
  });
  // 없는 CLI가 있어도 성공으로 끝나도록 스크립트가 exit 0 하지만, 종료 코드와 무관하게 출력만 본다
  const found = new Map<string, string>();
  for (const line of outputLines(r.stdout)) {
    if (!line.startsWith('/')) continue; // 로그인 셸 배너·별칭 등 제외
    const name = posix.basename(line);
    if (targets.includes(name) && !found.has(name)) found.set(name, line);
  }
  const location = `wsl:${distro}` as const;
  return Promise.all(
    [...found].map(([name, path]) =>
      inspectEngine(name, path, location, {
        exec,
        versionTimeoutMs: opts.versionTimeoutMs,
        versionArgs: { file: wsl, args: ['-d', distro, '-e', path, '--version'] },
      }),
    ),
  );
}

/** Windows 호스트에서 모든 WSL 배포판 확인. 다른 플랫폼이면 빈 배열 */
export async function scanWsl(
  opts: WslOptions & { platform?: NodeJS.Platform } = {},
): Promise<EngineEntry[]> {
  if ((opts.platform ?? process.platform) !== 'win32') return [];
  const distros = await listWslDistros(opts);
  const per = await Promise.all(distros.map((d) => scanWslDistro(d, opts)));
  return per.flat();
}

/** 11.3 호스트 PATH + WSL 결과를 합친다. 같은 CLI가 양쪽에 있으면 항목 2개 */
export async function scanAllEngines(
  opts: PathScanOptions & { wsl?: WslOptions | false } = {},
): Promise<EngineEntry[]> {
  const [host, wsl] = await Promise.all([
    scanPathEngines(opts),
    opts.wsl === false
      ? Promise.resolve([])
      : scanWsl({ exec: opts.exec, platform: opts.platform, ...(opts.wsl ?? {}) }),
  ]);
  return [...host, ...wsl];
}
