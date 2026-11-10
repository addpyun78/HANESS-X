import { defaultExec, type ExecFn } from './exec.js';

/** 10.3 --version 실행·파싱 (기본 5초 타임아웃) */
export const VERSION_TIMEOUT_MS = 5_000;

const VERSION_RE = /(?:^|[^\w.])v?(\d+\.\d+(?:\.\d+)?(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?)(?![0-9A-Za-z])/;

/**
 * 출력 문자열에서 첫 번째 버전 번호를 뽑는다.
 * 예) "2.1.3 (Claude Code)" → 2.1.3, "codex-cli 0.46.0" → 0.46.0, "v1.2" → 1.2.0
 */
export function parseVersion(output: string): string | null {
  for (const line of output.split(/\r?\n/)) {
    const m = VERSION_RE.exec(line);
    if (!m?.[1]) continue;
    const [core = '', ...pre] = m[1].split('-');
    const parts = core.split('.');
    while (parts.length < 3) parts.push('0');
    return [parts.join('.'), ...pre].join('-');
  }
  return null;
}

export interface VersionResult {
  version: string | null;
  /** 원문 첫 줄 (표시용) */
  raw?: string;
  error?: string;
}

export async function getVersion(
  executable: string,
  opts: { exec?: ExecFn; timeoutMs?: number; args?: string[] } = {},
): Promise<VersionResult> {
  const exec = opts.exec ?? defaultExec;
  const timeoutMs = opts.timeoutMs ?? VERSION_TIMEOUT_MS;
  const r = await exec(executable, opts.args ?? ['--version'], { timeoutMs });
  if (r.timedOut) return { version: null, error: `--version 시간 초과 (${timeoutMs}ms)` };
  const text = `${r.stdout.toString('utf8')}\n${r.stderr.toString('utf8')}`;
  const raw = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  const version = parseVersion(text);
  if (version) return { version, ...(raw ? { raw } : {}) };
  return {
    version: null,
    ...(raw ? { raw } : {}),
    error: r.error ?? `버전을 찾을 수 없음 (exit ${r.code})`,
  };
}
