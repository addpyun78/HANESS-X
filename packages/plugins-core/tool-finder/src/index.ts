export * from './need.js';
export * from './settings.js';
export * from './candidate.js';
export * from './sanitize.js';
export * from './pricing.js';
export * from './providers/types.js';
export * from './providers/package-repos.js';
export * from './providers/web.js';
export * from './normalize.js';
export * from './merge.js';
export * from './os.js';
export * from './rank.js';
export * from './reasons.js';
export * from './cache.js';
export * from './memory.js';
export * from './match.js';
export * from './assist.js';
export * from './finder.js';
export * from './trigger.js';
export * from './flow.js';
export * from './select.js';
export * from './api.js';

export function activate(ctx: { log(message: string): void }): void {
  ctx.log('tool-finder: 필요한 도구 찾기 준비');
}
