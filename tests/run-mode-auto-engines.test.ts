import { join } from 'node:path';
import { buildClaudeArgs } from '@harness-x/engine-claude-code';
import { buildExecArgs, threadParams } from '@harness-x/engine-codex';
import { HookBus, ReviewList } from '@harness-x/kernel';
import { createAutoApprover, installRunModeGate } from '@harness-x/permission-gate';
import { describe, expect, it } from 'vitest';
import { gateFixture } from '../packages/plugins-core/permission-gate/test/helpers.js';

// T-101 3D.6 엔진 매핑: claude --permission-mode acceptEdits(전체 우회 금지), codex --sandbox workspace-write
// --ask-for-approval never, 최종 권한 판단은 하네스 permission-gate — 인자 스냅샷 + 하네스 차단 우선

const pm = (a: string[]) => a[a.indexOf('--permission-mode') + 1];

describe('3D.6 오토 엔진 인자', () => {
  it('claude: acceptEdits, 권한이 전체여도 bypassPermissions 금지', () => {
    expect(buildClaudeArgs({ prompt: '끝까지', mode: 'auto', permission: 'workspace-write' }))
      .toMatchInlineSnapshot(`
      [
        "-p",
        "--output-format",
        "stream-json",
        "--verbose",
        "--permission-mode",
        "acceptEdits",
        "--",
        "끝까지",
      ]
    `);
    for (const p of ['read-only', 'workspace-write', 'full-access'] as const) {
      const a = buildClaudeArgs({ prompt: 'x', mode: 'auto', permission: p });
      expect(pm(a)).toBe('acceptEdits');
      expect(a).not.toContain('bypassPermissions');
      expect(a).not.toContain('--dangerously-skip-permissions');
    }
  });

  it('codex: --ask-for-approval never(최상위 옵션) + exec --sandbox workspace-write, 전체 접근 금지', () => {
    expect(buildExecArgs({ prompt: '끝까지', cwd: '/w', mode: 'auto', permission: 'full-access' }))
      .toMatchInlineSnapshot(`
      [
        "--ask-for-approval",
        "never",
        "exec",
        "--json",
        "--sandbox",
        "workspace-write",
        "--cd",
        "/w",
        "--skip-git-repo-check",
        "--",
        "끝까지",
      ]
    `);
    expect(threadParams({ prompt: 'x', cwd: '/w', mode: 'auto', permission: 'full-access' })).toMatchObject({
      sandbox: 'workspace-write',
      approvalPolicy: 'never',
    });
    const a = buildExecArgs({ prompt: 'x', cwd: '/w', mode: 'auto' });
    expect(a).not.toContain('danger-full-access');
    expect(a).not.toContain('--dangerously-bypass-approvals-and-sandbox');
  });

  it('일반 모드는 기존 매핑 그대로 (오토 인자 없음)', () => {
    expect(buildExecArgs({ prompt: 'x', cwd: '/w', mode: 'normal' })[0]).toBe('exec');
    expect(pm(buildClaudeArgs({ prompt: 'x', mode: 'normal', permission: 'full-access' }))).toBe(
      'bypassPermissions',
    );
  });
});

describe('3D.6 하네스 차단 우선', () => {
  it('엔진은 수정을 자동 허용(acceptEdits)해도, 하네스 게이트가 설치·파괴적 명령·작업 폴더 밖 쓰기를 막는다', async () => {
    const review = new ReviewList();
    let approve: ReturnType<typeof createAutoApprover> = () => false;
    const f = gateFixture({ approve: (a) => approve(a) });
    try {
      approve = createAutoApprover({ sessionId: 's1', review, ledger: f.ledger });
      installRunModeGate(f.bus, {
        mode: () => 'auto',
        onHumanOnly: (m) => review.add({ sessionId: 's1', kind: 'human-only', reason: m.reason }),
      });
      f.lockPlan();
      // 엔진 쪽 설정: 묻지 않고 수정
      expect(pm(buildClaudeArgs({ prompt: 'x', mode: 'auto', permission: 'full-access' }))).toBe(
        'acceptEdits',
      );

      const install = await f.tool('Bash', { command: 'npm install left-pad' });
      expect(install).toMatchObject({ decision: 'deny', hookId: 'permission-gate:run-mode' });
      const destroy = await f.tool('Bash', { command: 'git reset --hard HEAD~5' });
      expect(destroy).toMatchObject({ decision: 'deny', hookId: 'permission-gate:run-mode' });
      const outside = await f.tool('Write', { file_path: join(f.ws, '..', 'other', 'x.txt') });
      expect(outside).toMatchObject({ decision: 'deny', hookId: 'permission-gate:plan-gate' });
      // 계획 안의 수정은 그대로 된다
      expect((await f.tool('Write', { file_path: 'docs/readme.md' })).decision).toBe('allow');
      expect(
        review
          .open('s1')
          .map((r) => r.kind)
          .sort(),
      ).toEqual(['human-only', 'permission']);
    } finally {
      f.cleanup();
    }
  });

  it('게이트는 엔진보다 먼저: 모드 게이트 우선순위 5 < 계획 게이트 10', async () => {
    const bus = new HookBus();
    installRunModeGate(bus, { mode: () => 'auto' });
    const r = await bus.runBlocking('tool.before', { tool: 'Bash', input: { command: 'rm -rf ~' } });
    expect(r.decision).toBe('deny');
  });
});
