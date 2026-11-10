import { afterEach, describe, expect, it } from 'vitest';
import { gateFixture, type GateFixture } from './helpers.js';

// 24.1 tool.before: 체크리스트 미확정이면 쓰기 도구(Edit/Write/쓰기형 Bash) deny
describe('24.1 plan gate', () => {
  let f: GateFixture;
  afterEach(() => f.cleanup());

  it('계획 전 Write·Edit·쓰기형 Bash 차단, 읽기는 허용', async () => {
    f = gateFixture();
    expect(f.gate.isPlanLocked()).toBe(false);
    for (const [tool, input] of [
      ['Write', { file_path: 'harness/mobile/a.kt', content: 'x' }],
      ['Edit', { file_path: 'harness/mobile/a.kt', old_string: 'a', new_string: 'b' }],
      ['write_file', { path: 'a.txt', content: 'x' }],
      ['Bash', { command: 'echo hi > a.txt' }],
      ['apply_patch', { input: '*** Begin Patch\n*** Add File: a.txt\n+hi\n*** End Patch' }],
    ] as const) {
      const r = await f.tool(tool, input);
      expect(r.decision, tool).toBe('deny');
      expect(r.reason).toMatch(/^plan_not_locked/);
      expect(r.hookId).toBe('permission-gate:plan-gate');
    }
    for (const [tool, input] of [
      ['Read', { file_path: 'a.txt' }],
      ['Bash', { command: 'ls -la && git status' }],
      ['read_file', { path: 'a.txt' }],
    ] as const)
      expect((await f.tool(tool, input)).decision, tool).toBe('allow');
  });

  it('체크리스트만 있고 manifest가 잠기지 않았으면 여전히 차단, Lock 후 정식 경로 쓰기 허용', async () => {
    f = gateFixture();
    f.ledger.create([
      { id: '1', title: '화면 구현', artifactId: 'art.mobile-app', acceptance: [{ type: 'file_exists' }] },
    ]);
    expect((await f.tool('Write', { file_path: 'harness/mobile/a.kt', content: '' })).decision).toBe('deny');
    f.manifest.lock([{ artifactId: 'art.mobile-app', displayName: '하네스/모바일', kind: 'dir' }], {
      glossary: {
        version: 1,
        terms: [
          { canonical: 'harness', aliases: ['하네스'] },
          { canonical: 'mobile', aliases: ['모바일'] },
        ],
      },
    });
    expect(f.gate.isPlanLocked()).toBe(true);
    expect((await f.tool('Write', { file_path: 'harness/mobile/a.kt', content: '' })).decision).toBe('allow');
  });
});
