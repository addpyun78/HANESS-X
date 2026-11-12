// @features F-102
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installRunModeGate, PLAN_GATE_HOOK_ID } from '../src/index.js';
import { gateFixture, type GateFixture } from './helpers.js';

// T-101 3C.1 일반 모드 = 지금 동작 그대로 (명문화): 계획 승인 필요, 권한 ask, 승인 카드(approval_request) 표시

let f: GateFixture | undefined;
afterEach(() => f?.cleanup());

describe('3C.1 일반 모드 회귀', () => {
  it('계획 승인(Lock) 전 쓰기는 계획 게이트가 막는다 — 모드 게이트는 비켜선다', async () => {
    f = gateFixture();
    installRunModeGate(f.bus, { mode: () => 'normal' });
    const r = await f.tool('Write', { file_path: 'docs/readme.md' });
    expect(r.decision).toBe('deny');
    expect(r.hookId).toBe(PLAN_GATE_HOOK_ID);
    expect(r.reason).toContain('plan_not_locked');
  });

  it('승인 후 계획 안 경로는 허용, 계획 밖은 사람에게 묻고(ask) 승인 카드 이벤트를 남긴다', async () => {
    const approve = vi.fn(() => true);
    f = gateFixture({ approve });
    installRunModeGate(f.bus, { mode: () => 'normal' });
    f.lockPlan();
    expect((await f.tool('Write', { file_path: 'docs/readme.md' })).decision).toBe('allow');
    expect(approve).not.toHaveBeenCalled();

    const r = await f.tool('Write', { file_path: 'notes/extra.md' });
    expect(approve).toHaveBeenCalledOnce(); // ask: 사람 답을 기다린다
    expect(r.decision).toBe('allow'); // 사람이 허락
    const card = f.events.find((e) => e.type === 'approval_request');
    expect(card).toMatchObject({ kind: 'plan-gate.outside-manifest', options: ['allow', 'deny'] });
  });

  it('사람이 거부하면 막는다 (일반 모드는 자동 처리 없음)', async () => {
    f = gateFixture({ approve: () => false });
    installRunModeGate(f.bus, { mode: () => 'normal' });
    f.lockPlan();
    const r = await f.tool('Write', { file_path: 'notes/extra.md' });
    expect(r.decision).toBe('deny');
    expect(r.reason).toContain('사용자가 거부');
  });

  it('approve가 없으면 승인 대기(approval_required)로 막고 카드 이벤트만 남긴다', async () => {
    f = gateFixture();
    installRunModeGate(f.bus, { mode: () => 'normal' });
    f.lockPlan();
    const r = await f.tool('Bash', { command: 'echo x > notes/a.md' });
    expect(r.decision).toBe('deny');
    expect(r.reason).toContain('approval_required');
    expect(f.events.filter((e) => e.type === 'approval_request')).toHaveLength(1);
  });
});
