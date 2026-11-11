import { defaultExec, outputLines, type ExecFn } from './exec.js';

/**
 * 10.2 PATH 탐지: Windows는 where.exe, Unix는 which -a.
 * 실행 파일 경로만 돌려준다 (파일 내용은 읽지 않는다).
 */

export interface LocateOptions {
  platform?: NodeJS.Platform;
  exec?: ExecFn;
  timeoutMs?: number;
}

/** Windows에서 직접 실행 가능한 확장자 (확장자 없는 npm 셸 심은 제외) */
const WIN_EXEC_EXT = /\.(exe|cmd|bat|com)$/i;

/** 이름 → 발견된 경로 목록 (PATH 우선순위 순, 중복 제거). 없으면 빈 배열 */
export async function locateCommand(name: string, opts: LocateOptions = {}): Promise<string[]> {
  const platform = opts.platform ?? process.platform;
  const exec = opts.exec ?? defaultExec;
  // WSL에서 PATH에 /mnt/c 폴더가 많으면 첫 조회가 5초를 넘길 수 있다
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const isWin = platform === 'win32';
  const r = isWin
    ? await exec('where.exe', [name], { timeoutMs })
    : await exec('which', ['-a', name], { timeoutMs });
  if (r.code !== 0) return [];
  let lines = outputLines(r.stdout);
  if (isWin) lines = lines.filter((l) => WIN_EXEC_EXT.test(l));
  else lines = lines.filter((l) => l.startsWith('/'));
  return [...new Set(lines)];
}

/** 여러 이름을 병렬로 탐지. 첫 번째(우선) 경로만 담는다 */
export async function locateAll(
  names: readonly string[],
  opts: LocateOptions = {},
): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  const results = await Promise.all(names.map(async (n) => [n, await locateCommand(n, opts)] as const));
  for (const [n, paths] of results) if (paths[0]) found.set(n, paths[0]);
  return found;
}
