import { describe, expect, it } from 'vitest';
import { buildClaudeArgs, claudePermissionMode } from '../src/args.js';

const pm = (a: string[]) => a[a.indexOf('--permission-mode') + 1];

// T-101 3B.3 엔진 매핑: 계획 모드 → claude --permission-mode plan (권한 값과 상관없이)
describe('3B.3 claude 계획 모드 인자', () => {
  it('계획 모드 인자 스냅샷', () => {
    expect(buildClaudeArgs({ prompt: '계획만', mode: 'plan', permission: 'full-access' }))
      .toMatchInlineSnapshot(`
      [
        "-p",
        "--output-format",
        "stream-json",
        "--verbose",
        "--permission-mode",
        "plan",
        "--",
        "계획만",
      ]
    `);
  });

  it('권한이 무엇이든 계획 모드면 plan', () => {
    for (const p of ['read-only', 'workspace-write', 'full-access'] as const)
      expect(pm(buildClaudeArgs({ prompt: 'x', permission: p, mode: 'plan' }))).toBe('plan');
    expect(claudePermissionMode(undefined, 'plan')).toBe('plan');
  });

  it('일반 모드·모드 없음은 기존 권한 매핑 그대로', () => {
    expect(pm(buildClaudeArgs({ prompt: 'x', permission: 'workspace-write', mode: 'normal' }))).toBe(
      'acceptEdits',
    );
    expect(pm(buildClaudeArgs({ prompt: 'x', permission: 'read-only' }))).toBe('plan');
  });
});
