import type { EngineAdapter } from '@harness-x/protocol';
import { claudeCodeEngine } from './engine.js';

export * from './args.js';
export * from './errors.js';
export * from './parser.js';
export * from './engine.js';

/** 하네스 플러그인 진입점: engine 슬롯 제공 */
export const engines: EngineAdapter[] = [claudeCodeEngine];

export function activate(ctx: { log(message: string): void }): void {
  ctx.log(`engine ${claudeCodeEngine.id} ready`);
}
