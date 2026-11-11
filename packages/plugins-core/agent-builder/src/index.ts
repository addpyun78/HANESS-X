export * from './registry.js';
export * from './runner/index.js';
export * from './contract.js';
export * from './inventory/index.js';
export * from './designer/index.js';
export * from './drafts/index.js';

/** 하네스 플러그인 진입점 (빌더 UI·실행기는 이후 티켓) */
export function activate(ctx: { log(message: string): void }): void {
  ctx.log('agent-builder active');
}
