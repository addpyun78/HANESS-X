import { afterEach, describe, expect, it } from 'vitest';
import { gateFixture, type GateFixture } from './helpers.js';

// 24.5 매칭 실패(manifest 밖) → 엄격 모드면 deny, 기본 모드면 ask
describe('24.5 outside manifest', () => {
  let f: GateFixture;
  afterEach(() => f.cleanup());

  it('strict: deny, approval_request 없음', async () => {
    f = gateFixture({ mode: 'strict' });
    f.lockPlan();
    const r = await f.tool('Write', { file_path: 'src/other.ts', content: '' });
    expect(r.decision).toBe('deny');
    expect(r.reason).toMatch(/^outside_manifest: .*strict/);
    expect(f.events.filter((e) => e.type === 'approval_request')).toHaveLength(0);
    expect((await f.tool('Write', { file_path: 'docs/readme.md', content: '' })).decision).toBe('allow');
  });

  it('default(승인 콜백 없음): approval_request 이벤트 + 승인 대기 deny, grant 후 허용', async () => {
    f = gateFixture();
    f.lockPlan();
    const r = await f.tool('Bash', { command: 'echo x > notes/todo.md' });
    expect(r.decision).toBe('deny');
    expect(r.reason).toMatch(/^approval_required/);
    const asks = f.events.filter((e) => e.type === 'approval_request');
    expect(asks).toHaveLength(1);
    expect(asks[0]).toMatchObject({
      sessionId: 's1',
      kind: 'plan-gate.outside-manifest',
      detail: { tool: 'Bash', paths: ['notes/todo.md'] },
      options: ['allow', 'deny'],
    });
    expect(r.reason).toContain(String(asks[0]!.approvalId));
    f.gate.grant('notes/todo.md');
    expect((await f.tool('Bash', { command: 'echo x > notes/todo.md' })).decision).toBe('allow');
  });

  it('default + approve 콜백: 승인하면 allow(이후 같은 경로 기억), 거부하면 deny', async () => {
    const asked: string[][] = [];
    let answer = true;
    f = gateFixture({
      approve: (req) => {
        asked.push(req.paths);
        return answer;
      },
    });
    f.lockPlan();
    expect((await f.tool('Write', { file_path: 'scratch.txt', content: '' })).decision).toBe('allow');
    expect((await f.tool('Write', { file_path: 'scratch.txt', content: '' })).decision).toBe('allow');
    expect(asked).toEqual([['scratch.txt']]);
    answer = false;
    const r = await f.tool('Write', { file_path: '/tmp/elsewhere.txt', content: '' });
    expect(r.decision).toBe('deny');
    expect(r.reason).toMatch(/사용자가 거부/);
    expect(f.events.filter((e) => e.type === 'approval_request')).toHaveLength(2);
  });
});
