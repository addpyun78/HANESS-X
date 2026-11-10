/**
 * {{displayName}} — 스킬 플러그인
 * 지침은 SKILL.md에 있다. 하네스가 이 스킬을 역할 노드에 끼우면 SKILL.md 내용이 컨텍스트로 들어간다.
 */

export interface PluginContext {
  manifest: { id: string; version: string };
  log(message: string): void;
}

export const SKILL_ID = '{{id}}';
export const SKILL_FILE = 'SKILL.md';

export function activate(ctx: PluginContext): void {
  ctx.log(`skill ${SKILL_ID} ready (${SKILL_FILE})`);
}

export function deactivate(): void {}
