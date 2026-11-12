export * from './card.js';
export * from './plain-korean.js';
export * from './confidence.js';
export * from './templates.js';
export * from './store.js';
export * from './dictionary.js';
export * from './handlers.js';
export * from './ai-accepts.js';
export * from './session.js';
export * from './cli.js';
export * from './auto-mode.js';

export function activate(ctx: { log(message: string): void }): void {
  ctx.log('approvals: 쉬운 말 승인 카드 준비');
}
