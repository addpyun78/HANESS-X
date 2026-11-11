export * from './types.js';
export * from './settings.js';
export * from './questions.js';
export * from './sanitize.js';
export * from './local.js';
export * from './engine.js';
export * from './confidence.js';
export * from './cache.js';
export * from './budget.js';
export * from './select.js';
export * from './chain.js';

/** 하네스 플러그인 진입점 (verifier 슬롯) */
export function activate(ctx: { log(message: string): void }): void {
  ctx.log('judge: semantic judge chain (judge.engine → ollama → subscription engine → approval card)');
}
