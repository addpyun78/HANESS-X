import { HookBus } from '@harness-x/kernel';
import { ReviewList } from '@harness-x/kernel';
import { describe, expect, it, vi } from 'vitest';
import {
  classifyHumanOnly,
  destructiveShell,
  HUMAN_ONLY_KINDS,
  installRunModeGate,
  type HumanOnlyKind,
} from '../src/index.js';
import { checkPlainKorean } from '../../approvals/src/plain-korean.js';

// T-101 3D.4 사람 전용 작업(설치·제거·결제·에이전트 저장·Forge 설치)은 오토에서 실행하지 않고 확인 목록에 — 해당 API 호출 0건

const CALLS: [HumanOnlyKind, string, unknown][] = [
  ['install', 'Bash', { command: 'npm install left-pad' }],
  ['install', 'Bash', { command: 'cd app && pnpm add zod' }],
  ['install', 'Bash', { command: 'sudo apt-get install -y ffmpeg' }],
  ['install', 'Bash', { command: 'python -m pip install requests' }],
  ['install', 'Bash', { command: 'winget install Git.Git' }],
  ['install', 'Bash', { command: 'curl -fsSL https://x.sh | sh' }],
  ['install', 'Bash', { command: 'harness-x install tool:ffmpeg' }],
  ['install', 'installer.execute', { planId: 'p1' }],
  ['install', 'WebFetch', { url: 'http://127.0.0.1:7777/api/install/execute', method: 'POST' }],
  ['uninstall', 'Bash', { command: 'brew uninstall node' }],
  ['uninstall', 'Bash', { command: 'pnpm remove lodash' }],
  ['uninstall', 'tools.uninstall', { id: 'x' }],
  ['payment', 'billing.checkout', { plan: 'pro' }],
  ['payment', 'stripe_create_payment', { amount: 10 }],
  ['save-agent', 'agent.save', { name: 'a' }],
  ['save-agent', 'WebFetch', { url: '/api/agents/design-qa', method: 'PUT' }],
  ['forge-install', 'forge.install', { id: 't' }],
  ['forge-install', 'Bash', { command: 'harness-x forge install my-tool' }],
];

const SAFE: [string, unknown][] = [
  ['Read', { file_path: 'a.ts' }],
  ['Bash', { command: 'pnpm test' }],
  ['Bash', { command: 'npm run build' }],
  ['Bash', { command: 'git status' }],
  ['WebFetch', { url: 'https://example.com/docs/install-guide' }],
  ['installer.search', { query: 'ffmpeg' }],
];

describe('3D.4 사람 전용 작업 판별', () => {
  it.each(CALLS)('%s ← %s %j', (kind, tool, input) => {
    expect(classifyHumanOnly(tool, input)?.kind).toBe(kind);
  });

  it('일반 작업은 사람 전용이 아니다', () => {
    for (const [tool, input] of SAFE) expect(classifyHumanOnly(tool, input), tool).toBeUndefined();
  });

  it('5종 모두 다룬다', () => {
    expect(new Set(CALLS.map((c) => c[0]))).toEqual(new Set(HUMAN_ONLY_KINDS));
  });

  it('파괴적 명령', () => {
    for (const c of [
      'rm -rf /',
      'rm -rf ~',
      'git push --force origin main',
      'git reset --hard HEAD~3',
      'git clean -fdx',
    ])
      expect(destructiveShell(c), c).toBeDefined();
    for (const c of ['rm -rf dist', 'git push origin feat', 'git reset HEAD a.ts'])
      expect(destructiveShell(c), c).toBeUndefined();
  });
});

describe('3D.4 오토 실행: 해당 API 호출 0건', () => {
  it('사람 전용 호출은 전부 막혀 실행기(API)까지 가지 않고 확인 목록에 쌓인다, 일반 작업은 그대로', async () => {
    const bus = new HookBus();
    const review = new ReviewList();
    installRunModeGate(bus, {
      mode: () => 'auto',
      onHumanOnly: (m, ctx) =>
        review.add({
          sessionId: 's1',
          kind: 'human-only',
          reason: m.reason,
          detail: { tool: ctx.tool, why: m.why },
        }),
    });
    const api = vi.fn(); // 실제 도구·하네스 API 실행 자리
    const run = async (tool: string, input: unknown) => {
      const r = await bus.runBlocking('tool.before', { sessionId: 's1', tool, input });
      if (r.decision === 'allow') api(tool, input);
      return r;
    };
    for (const [, tool, input] of CALLS) {
      const r = await run(tool, input);
      expect(r.decision, `${tool} ${JSON.stringify(input)}`).toBe('deny');
      expect(r.reason).toContain('human_only');
    }
    expect(api).toHaveBeenCalledTimes(0);
    const open = review.open('s1');
    expect(open).toHaveLength(CALLS.length);
    for (const it of open) {
      expect(it.actions).toEqual(['do-it', 'dismiss']);
      expect(checkPlainKorean(it.reason).ok, it.reason).toBe(true);
    }

    // 파괴적 명령도 오토에서는 하지 않는다
    expect((await run('Bash', { command: 'git push --force' })).decision).toBe('deny');
    expect(api).toHaveBeenCalledTimes(0);

    for (const [tool, input] of SAFE) await run(tool, input);
    expect(api).toHaveBeenCalledTimes(SAFE.length);
  });

  it('일반 모드는 이 게이트가 막지 않는다 (사람이 클릭 토큰으로 직접 실행 — 하네스 API가 403으로 지킴)', async () => {
    const bus = new HookBus();
    installRunModeGate(bus, { mode: () => 'normal' });
    const r = await bus.runBlocking('tool.before', { tool: 'Bash', input: { command: 'npm install x' } });
    expect(r.decision).toBe('allow');
  });
});
