import type { PermissionMode } from '@harness-x/protocol';

/** 하네스 권한 모드 → agy --mode */
export const AGY_MODES: Record<PermissionMode, string> = {
  'read-only': 'plan',
  'workspace-write': 'accept-edits',
  'full-access': 'auto',
};

export interface AgyArgsInput {
  prompt: string;
  model?: string;
  permission?: PermissionMode;
  resumeId?: string;
}

/**
 * 16.1 agy 실행 인자: --output-format stream-json --mode <모드> [--model <모델>] [--conversation <id>] -p <프롬프트>
 * 헤드리스에서는 권한 프롬프트를 띄울 수 없으므로 full-access일 때만 --dangerously-skip-permissions를 붙인다.
 */
export function buildAgyArgs(input: AgyArgsInput): string[] {
  const permission = input.permission ?? 'workspace-write';
  const args = ['--output-format', 'stream-json', '--mode', AGY_MODES[permission]];
  if (permission === 'full-access') args.push('--dangerously-skip-permissions');
  if (input.model) args.push('--model', input.model);
  if (input.resumeId) args.push('--conversation', input.resumeId);
  args.push('-p', input.prompt);
  return args;
}
