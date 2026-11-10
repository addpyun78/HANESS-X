import type { EngineAdapter } from '@harness-x/protocol';
import { codexEngine } from './engine.js';

export * from './args.js';
export * from './errors.js';
export * from './jsonrpc.js';
export * from './app-server.js';
export * from './exec-parser.js';
export * from './engine.js';

/** 하네스 플러그인 진입점: engine 슬롯 제공 */
export const engines: EngineAdapter[] = [codexEngine];

export function activate(ctx: { log(message: string): void }): void {
  ctx.log(`engine ${codexEngine.id} ready`);
}
