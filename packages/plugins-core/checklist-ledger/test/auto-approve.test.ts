import { describe, expect, it, vi } from 'vitest';
import {
  AUTO_PLAN_PAUSED_MESSAGE,
  AUTO_REDECOMPOSE_MAX,
  autoApprovePlan,
  type LintItem,
} from '../src/index.js';

// T-101 3D.1 오토 계획 자동 승인: 린터 통과 필수, 실패 시 자동 재분해 최대 3회 → 그래도 실패면 일시정지 + 알림

const good: LintItem = {
  id: '1',
  title: '로그인 화면 구현',
  artifactId: 'art.login',
  acceptance: [{ type: 'test' }],
};
const bad: LintItem = {
  id: '1',
  title: '로그인 화면 구현',
  artifactId: ['art.a', 'art.b'],
  acceptance: [{ type: 'test' }],
};

function deps() {
  return { lock: vi.fn(), pause: vi.fn(), notify: vi.fn() };
}

describe('3D.1 린터 실패 시나리오', () => {
  it('처음부터 통과하면 바로 확정, 재분해 0회', async () => {
    const d = deps();
    const redecompose = vi.fn();
    const r = await autoApprovePlan({ items: [good], redecompose, ...d });
    expect(r).toMatchObject({ status: 'locked', redecomposed: 0 });
    expect(d.lock).toHaveBeenCalledWith([good]);
    expect(redecompose).not.toHaveBeenCalled();
    expect(d.pause).not.toHaveBeenCalled();
  });

  it('두 번 실패 후 세 번째에 통과 → 확정 (위반 내용을 엔진에 돌려줌)', async () => {
    const d = deps();
    const plans = [[bad], [good]];
    const redecompose = vi.fn((_fb: string, n: number) => plans[n - 1]!);
    const r = await autoApprovePlan({ items: [bad], redecompose, ...d });
    expect(r).toMatchObject({ status: 'locked', redecomposed: 2 });
    expect(redecompose.mock.calls[0]![0]).toContain('R2');
    expect(redecompose.mock.calls[0]![0]).toContain('재분해 요청');
    expect(d.lock).toHaveBeenCalledOnce();
    expect(d.pause).not.toHaveBeenCalled();
  });

  it('재분해 3회 모두 실패 → 확정하지 않고 일시정지 + 알림', async () => {
    const d = deps();
    const redecompose = vi.fn(() => [bad]);
    const r = await autoApprovePlan({ items: [bad], redecompose, ...d });
    expect(AUTO_REDECOMPOSE_MAX).toBe(3);
    expect(redecompose).toHaveBeenCalledTimes(3);
    expect(r).toMatchObject({ status: 'paused', redecomposed: 3 });
    expect(d.lock).not.toHaveBeenCalled();
    expect(d.pause).toHaveBeenCalledWith('plan_lint');
    expect(d.notify).toHaveBeenCalledWith(AUTO_PLAN_PAUSED_MESSAGE, expect.any(Array));
  });
});
