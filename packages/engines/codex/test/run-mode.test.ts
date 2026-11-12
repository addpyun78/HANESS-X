import { describe, expect, it } from 'vitest';
import { buildExecArgs, codexSandbox, threadParams } from '../src/args.js';

const sb = (a: string[]) => a[a.indexOf('--sandbox') + 1];

// T-101 3B.3 엔진 매핑: 계획 모드 → codex --sandbox read-only (권한 값과 상관없이)
describe('3B.3 codex 계획 모드 인자', () => {
  it('exec 인자 스냅샷', () => {
    expect(buildExecArgs({ prompt: '계획만', cwd: '/w', mode: 'plan', permission: 'full-access' }))
      .toMatchInlineSnapshot(`
      [
        "exec",
        "--json",
        "--sandbox",
        "read-only",
        "--cd",
        "/w",
        "--skip-git-repo-check",
        "--",
        "계획만",
      ]
    `);
  });

  it('app-server thread 파라미터도 read-only', () => {
    expect(
      threadParams({ prompt: 'x', cwd: '/w', mode: 'plan', permission: 'workspace-write' }).sandbox,
    ).toBe('read-only');
  });

  it('권한이 무엇이든 계획 모드면 read-only, 일반 모드는 기존 매핑', () => {
    for (const p of ['read-only', 'workspace-write', 'full-access'] as const)
      expect(sb(buildExecArgs({ prompt: 'x', cwd: '/w', permission: p, mode: 'plan' }))).toBe('read-only');
    expect(codexSandbox('workspace-write', 'normal')).toBe('workspace-write');
    expect(codexSandbox('full-access')).toBe('danger-full-access');
  });
});
