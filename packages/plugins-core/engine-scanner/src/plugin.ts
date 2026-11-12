import { getLoginStatus, type PluginContext } from '@harness-x/kernel';
import type { EngineEntry } from './cache.js';
import { EngineScanner } from './scanner.js';

/**
 * T-101 5A.6 로그인 상태: 커널 공식 상태 명령(auth-status.ts, 토큰 파일 안 읽음)만 쓴다. 모델 호출 없음.
 * 호스트에 있는 실행 파일만 확인한다 (WSL 안의 CLI는 unknown)
 */
export async function officialLoginState(e: EngineEntry): Promise<NonNullable<EngineEntry['login']>> {
  if (e.location.startsWith('wsl:')) return 'unknown';
  const r = await getLoginStatus(e.name, { executable: e.path });
  return r.state;
}

/** 하네스 플러그인 진입점: 활성화 시 1회 스캔 + 30분 주기 재스캔 */
let scanner: EngineScanner | undefined;

export function activate(ctx: PluginContext): void {
  const intervalMs = typeof ctx.config.intervalMs === 'number' ? ctx.config.intervalMs : undefined;
  scanner = new EngineScanner({
    ...(intervalMs ? { intervalMs } : {}),
    loginStatus: officialLoginState,
    onScan: (c) => ctx.log(`engines: ${c.engines.length}개 CLI, ${c.localLlms.length}개 로컬 LLM`),
    onError: (err) => ctx.log(`scan 실패: ${err instanceof Error ? err.message : String(err)}`),
  });
  // activate를 막지 않도록 백그라운드에서 스캔
  scanner.start().catch((err) => ctx.log(`scan 실패: ${err instanceof Error ? err.message : String(err)}`));
}

export function deactivate(): void {
  scanner?.stop();
  scanner = undefined;
}

export function activeScanner(): EngineScanner | undefined {
  return scanner;
}
