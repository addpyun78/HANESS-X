import type { PluginContext } from '@harness-x/kernel';

export * from './sse.js';
export * from './http.js';
export * from './openai.js';
export * from './json-fallback.js';
export * from './adapter.js';

/** 하네스 플러그인 진입점 (engine 슬롯). 엔진 등록 API가 생기면 여기서 어댑터를 등록한다 */
export function activate(ctx: PluginContext): void {
  ctx.log(`engines: ${(ctx.manifest.provides.engine ?? []).join(', ')}`);
}
