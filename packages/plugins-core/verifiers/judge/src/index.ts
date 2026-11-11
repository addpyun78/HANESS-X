export * from './types.js';
export * from './settings.js';
export * from './questions.js';

/** 하네스 플러그인 진입점 (verifier 슬롯) */
export function activate(ctx: { log(message: string): void }): void {
  ctx.log('judge: semantic judge chain (judge.engine → ollama → subscription engine → approval card)');
}
