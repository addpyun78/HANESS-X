import { afterEach, describe, expect, it } from 'vitest';
import { installRunModeGate, PLAN_MODE_DENY, planModeNext, RUN_MODE_GATE_HOOK_ID } from '../src/index.js';
import { gateFixture, type GateFixture } from './helpers.js';

// T-101 3B.1 계획 모드: 모든 쓰기 도구 차단(permission-gate), 체크리스트 작성까지만 → 계획 확인 대기

const WRITES: [string, unknown][] = [
  ['Write', { file_path: 'harness/mobile/app.ts', content: 'x' }],
  ['Edit', { file_path: 'docs/readme.md', old_string: 'a', new_string: 'b' }],
  ['MultiEdit', { file_path: 'docs/readme.md', edits: [] }],
  ['NotebookEdit', { notebook_path: 'n.ipynb' }],
  ['apply_patch', { input: '*** Begin Patch\n*** Add File: harness/mobile/b.ts\n+x\n*** End Patch' }],
  ['write_file', { path: 'a.txt' }],
  ['Bash', { command: 'echo hi > harness/mobile/c.ts' }],
  ['Bash', { command: 'rm -rf harness' }],
  ['Bash', { command: 'git commit -am x' }],
  ['Bash', { command: 'npm install left-pad' }],
  ['shell', { command: ['bash', '-lc', 'touch x'] }],
];
const READS: [string, unknown][] = [
  ['Read', { file_path: 'docs/readme.md' }],
  ['Grep', { pattern: 'x' }],
  ['Bash', { command: 'ls -la && git status' }],
  ['checklist.propose', { items: [] }],
  ['manifest.resolve', { artifactId: 'art.readme' }],
];

let f: GateFixture | undefined;
afterEach(() => f?.cleanup());

describe('3B.1 계획 모드 쓰기 차단', () => {
  it('계획이 확정돼 있어도 계획 모드면 쓰기 시도 0건 통과, 읽기·체크리스트 작성은 된다', async () => {
    f = gateFixture();
    f.lockPlan(); // 일반 계획 게이트는 이제 쓰기를 허용하는 상태
    let mode: 'plan' | 'normal' = 'plan';
    installRunModeGate(f.bus, { mode: () => mode });

    let passed = 0;
    for (const [tool, input] of WRITES) {
      const r = await f.tool(tool, input);
      if (r.decision === 'allow') passed++;
      else {
        expect(r.hookId).toBe(RUN_MODE_GATE_HOOK_ID);
        // 설치처럼 사람 전용 작업은 3D.4 사유(human_only)로 먼저 막힌다
        if (!r.reason!.startsWith('human_only')) expect(r.reason).toContain(PLAN_MODE_DENY);
      }
    }
    expect(passed).toBe(0);

    for (const [tool, input] of READS) expect((await f.tool(tool, input)).decision, tool).toBe('allow');

    // 일반 모드로 바꾸면 이 게이트는 비켜선다 (manifest 안 경로 쓰기 허용)
    mode = 'normal';
    expect((await f.tool('Write', { file_path: 'docs/readme.md' })).decision).toBe('allow');
  });

  it('체크리스트가 생기면 계획 확인 대기, 다른 모드는 계속', () => {
    expect(planModeNext('plan', false)).toBe('continue');
    expect(planModeNext('plan', true)).toBe('await-plan-confirm');
    expect(planModeNext('normal', true)).toBe('continue');
    expect(planModeNext('auto', true)).toBe('continue');
  });
});
