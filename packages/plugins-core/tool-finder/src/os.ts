import { detectHostPlatform, type InstallKind } from '@harness-x/installer';
import type { CandidateOs, ToolCandidate } from './candidate.js';
import type { UserOs } from './need.js';

/**
 * P3-B.7 Windows/WSL 호환 필터 (현재 사용자 환경 기준)
 *   windows: Windows용만
 *   wsl:     Windows용 또는 리눅스용 (둘 다 쓸 수 있다)
 *   posix:   리눅스·맥용
 * 설치 방법도 환경에서 못 쓰는 것(예: posix에서 winget)은 뺀다. 남는 설치 방법이 없고 OS도 안 맞으면 후보 제외.
 * OS 정보가 아예 없는 후보는 남기되 정렬(C.1)에서 뒤로 보낸다.
 */

export function currentUserOs(): UserOs {
  return detectHostPlatform();
}

const OS_OK: Record<UserOs, readonly CandidateOs[]> = {
  windows: ['windows'],
  wsl: ['windows', 'linux'],
  posix: ['linux', 'mac'],
};

const WINDOWS_ONLY_KINDS: readonly InstallKind[] = ['winget', 'scoop', 'choco', 'direct-download'];
const LINUX_ONLY_KINDS: readonly InstallKind[] = ['wsl-apt'];

export function kindUsable(kind: InstallKind, os: UserOs): boolean {
  if (WINDOWS_ONLY_KINDS.includes(kind)) return os !== 'posix';
  if (LINUX_ONLY_KINDS.includes(kind)) return os !== 'windows';
  return true;
}

/** 0 = 맞음, 1 = 모름(정보 없음), 2 = 안 맞음 */
export function osMatch(c: Pick<ToolCandidate, 'os'>, os: UserOs): 0 | 1 | 2 {
  if (c.os.length === 0) return 1;
  return c.os.some((o) => OS_OK[os].includes(o)) ? 0 : 2;
}

export function filterByOs(list: readonly ToolCandidate[], os: UserOs): ToolCandidate[] {
  const out: ToolCandidate[] = [];
  for (const c of list) {
    if (osMatch(c, os) === 2) continue;
    const methods = c.installMethods.filter((m) => kindUsable(m.kind, os));
    if (c.installMethods.length > 0 && methods.length === 0) continue;
    out.push({ ...c, installMethods: methods });
  }
  return out;
}
