import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * T-100 삭제된 외부 판정 서비스의 이름(도메인·플러그인 id·설정 값)을 조사 파일에서 읽는다.
 * 코드·테스트에는 그 이름을 적지 않는다(P1-J.8). 조사 파일: docs/tickets/T-100-<서비스>-sites.md (P1-A.3)
 * label: 조사 파일 줄의 앞부분 (예: '차단 대상 도메인')
 */
const TICKETS = fileURLToPath(new URL('../../docs/tickets/', import.meta.url));

export function retiredName(label: string): string {
  for (const f of readdirSync(TICKETS).filter((n) => /^T-100-.+-sites\.md$/.test(n))) {
    const m = new RegExp(`${label}[^\`\\n]*\`([^\`]+)\``).exec(readFileSync(join(TICKETS, f), 'utf8'));
    if (m) return m[1]!;
  }
  throw new Error(`docs/tickets/T-100-*-sites.md에서 '${label}' 줄을 찾지 못함`);
}

export const RETIRED_DOMAIN_LABEL = '차단 대상 도메인';
export const RETIRED_PLUGIN_LABEL = '삭제된 플러그인 id';
export const RETIRED_CONFIG_LABEL = '예전 설정 값·절 이름';
