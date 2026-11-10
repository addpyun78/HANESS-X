import type { PluginContext } from '@harness-x/kernel';
import { EngineScanner } from './scanner.js';

/** 하네스 플러그인 진입점: 활성화 시 1회 스캔 + 30분 주기 재스캔 */
let scanner: EngineScanner | undefined;

export function activate(ctx: PluginContext): void {
  const intervalMs = typeof ctx.config.intervalMs === 'number' ? ctx.config.intervalMs : undefined;
  scanner = new EngineScanner({
    ...(intervalMs ? { intervalMs } : {}),
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
