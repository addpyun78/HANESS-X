// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InstallPlanCard } from '../src/install/InstallPlanCard.js';
import { ActionCard } from '../src/panels/Approvals/ActionCard.js';
import { ApprovalsArea } from '../src/panels/Approvals/ApprovalsArea.js';
import { useApprovals } from '../src/panels/Approvals/useApprovals.js';
import { fixtureCard } from './approvals-fixtures.js';
import { fixturePlan } from './install-fixtures.js';

afterEach(cleanup);

vi.mock('../src/panels/Approvals/ActionCard.js', async (orig) => {
  const m = await orig<typeof import('../src/panels/Approvals/ActionCard.js')>();
  return { ...m, ActionCard: vi.fn(m.ActionCard) };
});

const extraOf = (plans: ReturnType<typeof fixturePlan>[], onExec = vi.fn()) =>
  plans.map((plan) => ({
    id: plan.id,
    render: ({ autoFocus }: { autoFocus: boolean }) => (
      <InstallPlanCard plan={plan} api={{ execute: onExec }} autoFocus={autoFocus} />
    ),
  }));

describe('P2-D.8 설치 카드는 Part 1 승인 카드 영역 재사용 (패널 상단·알림·배지·모바일 시트·키보드)', () => {
  it('같은 ActionCard 컴포넌트로, 같은 "확인이 필요해요" 영역 안에 그린다 (개수 배지 포함)', () => {
    const plan = fixturePlan();
    const card = fixtureCard('path-1');
    render(<ApprovalsArea cards={[card]} extra={extraOf([plan])} variant="panel" />);
    const area = screen.getByRole('region', { name: '확인이 필요해요' });
    const groups = within(area).getAllByRole('group');
    expect(groups.map((g) => g.dataset.cardId)).toEqual([card.id, plan.id]);
    expect(groups.every((g) => g.classList.contains('hx-action-card'))).toBe(true);
    // 승인 카드·설치 카드 모두 같은 ActionCard 함수로 그렸다
    const rendered = vi.mocked(ActionCard).mock.calls.map(([p]) => p.card.id);
    expect(rendered).toContain(card.id);
    expect(rendered).toContain(plan.id);
    expect(within(area).getByLabelText('카드 2장').textContent).toBe('2');
  });

  it('설치 카드만 있어도 영역이 뜨고, 첫 버튼 포커스 + 숫자 키 1로 [설치]', async () => {
    const plan = fixturePlan();
    const exec = vi.fn(async () => ({
      id: 'j',
      planId: plan.id,
      action: 'install' as const,
      status: 'queued',
    }));
    render(<ApprovalsArea cards={[]} extra={extraOf([plan], exec)} variant="panel" />);
    const install = screen.getByRole('button', { name: /설치/ });
    expect(document.activeElement).toBe(install);
    await act(async () => void fireEvent.keyDown(install, { key: '1' }));
    expect(exec).toHaveBeenCalledExactlyOnceWith(plan.id, 'install');
  });

  it('768px 미만이면 같은 하단 시트(role=dialog)에 뜬다', () => {
    render(<ApprovalsArea cards={[]} extra={extraOf([fixturePlan()])} variant="sheet" />);
    const sheet = screen.getByRole('dialog', { name: '확인이 필요해요' });
    expect(sheet.dataset.variant).toBe('sheet');
    expect(within(sheet).getByRole('group').dataset.cardId).toBe('plan_ffmpeg');
  });

  it('알림·탭 제목·사이드바 배지: useApprovals가 설치 카드도 함께 센다', () => {
    document.title = 'HARNESS-X';
    const { result, rerender } = renderHook(
      ({ extra }) => useApprovals({ events: [], baseTitle: 'HARNESS-X', extra }),
      { initialProps: { extra: [] as { id: string; sessionId?: string; text: string }[] } },
    );
    expect(result.current.toasts).toEqual([]);
    rerender({
      extra: [{ id: 'plan_ffmpeg', sessionId: 's1', text: '"ffmpeg" 설치 계획을 확인해 주세요.' }],
    });
    expect(result.current.toasts.map((t) => t.cardId)).toEqual(['plan_ffmpeg']);
    expect(result.current.toasts[0]!.text).toContain('"ffmpeg" 설치 계획을 확인해 주세요.');
    expect(document.title).toBe('(1) HARNESS-X');
    expect(result.current.bySession).toEqual({ s1: 1 });
  });
});
