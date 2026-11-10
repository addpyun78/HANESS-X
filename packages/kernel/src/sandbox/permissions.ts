import { isAbsolute, relative, resolve } from 'node:path';
import type { Permissions } from '@harness-x/protocol';

/**
 * 62.2 권한 검사기
 * 격리된 플러그인의 fs/net/shell 요청을 매니페스트 permissions로 판정한다.
 * - fs: workspace:read → 워크스페이스 안 읽기, workspace:write → 워크스페이스 안 쓰기(읽기 포함)
 * - net: 선언한 도메인(*.example.com 와일드카드 허용)만, http/https만
 * - shell: true일 때만
 */

export type FsOp = 'read' | 'write';

export class PermissionDeniedError extends Error {
  readonly code = 'ERR_PERMISSION_DENIED';
  constructor(
    readonly kind: 'fs' | 'net' | 'shell',
    message: string,
  ) {
    super(message);
  }
}

export interface PermissionCheck {
  ok: boolean;
  reason?: string;
}

const allow: PermissionCheck = { ok: true };
const deny = (reason: string): PermissionCheck => ({ ok: false, reason });

export function checkFs(
  perms: Permissions,
  workspace: string | undefined,
  op: FsOp,
  path: string,
): PermissionCheck {
  const need = op === 'read' ? ['workspace:read', 'workspace:write'] : ['workspace:write'];
  if (!perms.fs.some((p) => need.includes(p)))
    return deny(`fs ${op} 권한 없음 (${need.join(' 또는 ')} 필요)`);
  if (!workspace) return deny('워크스페이스가 지정되지 않음');
  const target = resolve(workspace, path);
  const rel = relative(resolve(workspace), target);
  if (rel.startsWith('..') || isAbsolute(rel)) return deny(`워크스페이스 밖 경로: ${path}`);
  return allow;
}

export function hostMatches(host: string, pattern: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '');
  if (pattern.startsWith('*.')) {
    const base = pattern.slice(2);
    return h.endsWith('.' + base);
  }
  return h === pattern;
}

export function checkNet(perms: Permissions, url: string): PermissionCheck {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return deny(`잘못된 URL: ${url}`);
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return deny(`허용되지 않은 프로토콜: ${u.protocol}`);
  if (!perms.net.some((d) => hostMatches(u.hostname, d)))
    return deny(`net 권한 없음: ${u.hostname} (선언: ${perms.net.join(', ') || '없음'})`);
  return allow;
}

export function checkShell(perms: Permissions): PermissionCheck {
  return perms.shell ? allow : deny('shell 권한 없음');
}
