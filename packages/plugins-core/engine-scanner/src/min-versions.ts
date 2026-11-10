import semver from 'semver';
import type { EngineTarget } from './targets.js';

/**
 * 10.4 엔진별 최소 지원 버전.
 * 어댑터가 쓰는 비대화형 실행·스트리밍 출력 옵션이 들어간 버전 기준. 어댑터 티켓(T-014~)에서 갱신한다.
 */
export const MIN_VERSIONS: Readonly<Record<EngineTarget, string>> = {
  claude: '2.0.0',
  codex: '0.40.0',
  agy: '1.0.0',
  gemini: '0.5.0',
  opencode: '0.10.0',
  'cursor-agent': '2025.8.0',
  qwen: '0.0.10',
  dsh: '0.1.0',
  'claude-agent-acp': '0.1.0',
  'codex-acp': '0.1.0',
};

export type VersionStatus = 'ok' | 'outdated' | 'unknown';

/** 날짜형(2025.09.18)·두 자리(1.12) 등 느슨한 버전을 semver로 정규화 */
export function normalizeVersion(v: string): string | null {
  const valid = semver.valid(v);
  if (valid) return valid;
  const m = /(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(v);
  if (!m) return null;
  return [m[1], m[2], m[3]].map((p) => String(parseInt(p ?? '0', 10))).join('.');
}

export function compareToMinimum(
  name: string,
  version: string | null,
  table: Readonly<Record<string, string>> = MIN_VERSIONS,
): { status: VersionStatus; minVersion?: string } {
  const minVersion = table[name];
  if (!minVersion) return { status: version ? 'ok' : 'unknown' };
  const v = version ? normalizeVersion(version) : null;
  if (!v) return { status: 'unknown', minVersion };
  return { status: semver.lt(v, minVersion) ? 'outdated' : 'ok', minVersion };
}
