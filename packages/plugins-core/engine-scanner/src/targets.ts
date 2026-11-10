/**
 * 10.1 탐지 대상 엔진 CLI 목록.
 * 구독 모드는 이 공식 바이너리를 수정 없이 자식 프로세스로 실행하는 방식으로만 쓴다.
 */
export const ENGINE_TARGETS = [
  'claude',
  'codex',
  'agy',
  'gemini',
  'opencode',
  'cursor-agent',
  'qwen',
  'dsh',
  'claude-agent-acp',
  'codex-acp',
] as const;

export type EngineTarget = (typeof ENGINE_TARGETS)[number];

export function isEngineTarget(name: string): name is EngineTarget {
  return (ENGINE_TARGETS as readonly string[]).includes(name);
}
