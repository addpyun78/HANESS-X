/**
 * {{displayName}} — 훅 플러그인
 * 차단형(onBlocking)은 allow/deny/block을 돌려주고, 알림형(onNotify)은 결과를 돌려주지 않는다.
 */

export type HookName =
  | 'session.start'
  | 'prompt.submit'
  | 'tool.before'
  | 'tool.after'
  | 'turn.end'
  | 'stop.before'
  | 'context.compact'
  | 'item.verify';

export interface HookContext {
  sessionId?: string;
  [key: string]: unknown;
}

export interface HookResult {
  decision: 'allow' | 'deny' | 'block';
  reason?: string;
}

export interface PluginContext {
  manifest: { id: string; version: string };
  log(message: string): void;
  hooks: {
    onBlocking(name: HookName, handler: (ctx: HookContext) => HookResult | void): () => void;
    onNotify(name: HookName, handler: (ctx: HookContext) => void): () => void;
  };
}

export const HOOK_ID = '{{id}}';

export function activate(ctx: PluginContext): void {
  ctx.hooks.onNotify('session.start', (c) => ctx.log(`${HOOK_ID}: session ${c.sessionId ?? '?'} started`));
  ctx.hooks.onBlocking('tool.before', () => ({ decision: 'allow' }));
}

export function deactivate(): void {}
