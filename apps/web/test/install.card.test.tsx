// @vitest-environment jsdom
import { checkPlainKorean } from './plain-check.js';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { Component, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InstallPlanCard } from '../src/install/InstallPlanCard.js';
import {
  ADMIN_TEXT,
  ADMIN_WAITING_TEXT,
  MissingPricingBadgeError,
  NO_PAYMENT_TEXT,
  PRICING_BADGES,
  UNKNOWN_CHECK_LABEL,
  cardTexts,
  planToCard,
  type InstallPlanView,
} from '../src/install/model.js';
import { SIX_PLANS, fixturePlan } from './install-fixtures.js';

afterEach(cleanup);

const execOk = () =>
  vi.fn(async (planId: string) => ({ id: 'job1', planId, action: 'install' as const, status: 'queued' }));

function cardEl(plan: InstallPlanView) {
  return screen.getByRole('group', { name: new RegExp(planToCard(plan).title.replace(/[?]/g, '\\?')) });
}

describe('P2-D.1 InstallPlan → 쉬운 말 카드 (종류별 6종 스냅샷, H.6 검사 통과)', () => {
  it.each(SIX_PLANS.map((p) => [p.kind, p] as const))('%s 카드', (_kind, plan) => {
    const card = planToCard(plan, { alternatives: true });
    const headings = card.sections.map((s) => s.heading);
    for (const h of [
      '무엇을',
      '어디서 받나요?',
      '무료인가요?',
      '사용 조건',
      '크기·시간',
      '관리자 권한',
      '바뀌는 것',
    ])
      expect(headings).toContain(h);
    if (plan.risks.length) expect(headings).toContain('조심할 점');
    expect(headings).toContain('지우는 방법');
    // H.6 쉬운 말 검사: 문장은 존댓말·짧게·어려운 말 없음, 이름표는 짧은 말
    const t = cardTexts(card);
    for (const s of t.sentences) expect(checkPlainKorean(s).violations, s).toEqual([]);
    for (const l of t.labels) expect(checkPlainKorean(l, { label: true }).violations, l).toEqual([]);
    const { container } = render(<InstallPlanCard plan={plan} onAlternatives={() => {}} />);
    expect(container.innerHTML).toMatchSnapshot();
  });

  it('스펙 예시(ffmpeg): 무엇을·어디서·크기·관리자 권한·지우는 방법', () => {
    render(<InstallPlanCard plan={fixturePlan()} />);
    const el = cardEl(fixturePlan());
    expect(el.textContent).toContain('📦 설치해도 될까요?');
    expect(el.textContent).not.toContain('✋');
    expect(el.textContent).toContain('윈도우 공식 앱 저장소("winget")에서 받아요.');
    expect(el.textContent).toContain('약 100MB, 1분 정도 걸려요.');
    expect(el.textContent).toContain('필요 없어요.');
    expect(el.textContent).toContain('설치 관리에서 [지우기]를 한 번 누르면 돼요.');
    expect(el.textContent).toContain('누구나 무료로 쓸 수 있어요.');
  });
});

/** 렌더 오류를 잡아 보여 주는 경계 (배지 없는 카드 = 렌더 오류) */
class Boundary extends Component<{ children: ReactNode }, { error?: Error }> {
  override state: { error?: Error } = {};
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override render() {
    return this.state.error ? <p role="alert">{this.state.error.name}</p> : this.props.children;
  }
}

describe('P2-D.2 무료/유료 배지 필수 (색 5가지, 없으면 렌더 오류)', () => {
  it('등급마다 배지 글자·색', () => {
    expect(PRICING_BADGES).toEqual({
      free: { label: '무료', tone: 'green' },
      freemium: { label: '무료+유료 기능', tone: 'blue' },
      trial: { label: '체험판', tone: 'orange' },
      paid: { label: '유료', tone: 'red' },
      unknown: { label: '무료인지 확인 못 했어요', tone: 'yellow' },
    });
    for (const tier of ['free', 'freemium', 'trial', 'paid', 'unknown'] as const) {
      const plan = fixturePlan({ id: `p-${tier}`, tier });
      const { unmount } = render(<InstallPlanCard plan={plan} />);
      const badge = document.querySelector<HTMLElement>('.hx-action-card__badge[data-tone]')!;
      expect(badge.textContent).toBe(`[${PRICING_BADGES[tier].label}]`);
      expect(badge.dataset.tone).toBe(PRICING_BADGES[tier].tone);
      expect(badge.className).toContain(`hx-action-card__badge--${PRICING_BADGES[tier].tone}`);
      unmount();
    }
  });

  it('렌더한 설치 카드에는 언제나 색 배지가 정확히 1개 있다 (6종)', () => {
    for (const plan of SIX_PLANS) {
      const { unmount } = render(<InstallPlanCard plan={plan} />);
      expect(document.querySelectorAll('.hx-action-card__badge[data-tone]')).toHaveLength(1);
      unmount();
    }
  });

  it('가격 정보가 없거나 모르는 등급이면 카드를 그리지 않고 오류', () => {
    const noPricing = { ...fixturePlan(), pricing: undefined } as unknown as InstallPlanView;
    const badTier = fixturePlan({
      pricing: { tier: 'cheap', note: '', checkedAt: '', sourceUrl: '' } as never,
    });
    expect(() => planToCard(noPricing)).toThrow(MissingPricingBadgeError);
    expect(() => planToCard(badTier)).toThrow(MissingPricingBadgeError);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <Boundary>
        <InstallPlanCard plan={noPricing} />
      </Boundary>,
    );
    spy.mockRestore();
    expect(screen.getByRole('alert').textContent).toBe('MissingPricingBadgeError');
    expect(screen.queryByRole('group')).toBeNull();
  });
});

describe('P2-D.3 유료·체험판: 가격 안내 + 결제는 하지 않음 + 공식 구매 페이지', () => {
  it('결제 관련 자동 동작 0건 — 구매 페이지는 사람이 누를 때만 열린다', async () => {
    for (const tier of ['paid', 'trial'] as const) {
      const plan = fixturePlan({ id: `p-${tier}`, tier, kind: 'api-service' });
      const openUrl = vi.fn();
      const fetchSpy = vi.fn();
      const api = { execute: execOk() };
      vi.stubGlobal('fetch', fetchSpy);
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
      const { unmount } = render(<InstallPlanCard plan={plan} api={api} openUrl={openUrl} />);
      const el = cardEl(plan);
      expect(el.textContent).toContain(plan.pricing.note);
      expect(el.textContent).toContain(NO_PAYMENT_TEXT);
      expect(el.textContent).toContain('[키 넣기]');
      // 그리기만 해서는 아무 일도 없다
      await act(async () => {});
      expect(openUrl).not.toHaveBeenCalled();
      expect(api.execute).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(openSpy).not.toHaveBeenCalled();
      fireEvent.click(within(el).getByRole('button', { name: /공식 구매 페이지 열기/ }));
      expect(openUrl).toHaveBeenCalledExactlyOnceWith('https://example.com/pricing');
      expect(api.execute).not.toHaveBeenCalled();
      openSpy.mockRestore();
      vi.unstubAllGlobals();
      unmount();
    }
  });

  it('무료 카드에는 구매 버튼·가격 안내가 없다', () => {
    const card = planToCard(fixturePlan());
    expect(card.buttons.map((b) => b.id)).not.toContain('open-purchase');
    expect(card.sections.map((s) => s.heading)).not.toContain('가격 안내');
  });
});

describe('P2-D.4 확인 못 함(unknown): "무료인지 직접 확인했어요"를 켜야 설치 버튼 활성', () => {
  it('체크 전 비활성 → 체크 후 활성 → 누르면 실행', async () => {
    const plan = fixturePlan({ tier: 'unknown' });
    const api = { execute: execOk() };
    render(<InstallPlanCard plan={plan} api={api} />);
    const el = cardEl(plan);
    const install = within(el).getByRole('button', { name: /설치/ });
    const box = within(el).getByRole('checkbox', { name: UNKNOWN_CHECK_LABEL });
    // 체크 상자는 설치 버튼 위에 있다
    expect(box.compareDocumentPosition(install) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect((install as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(install);
    act(() => void fireEvent.keyDown(install, { key: '1' }));
    expect(api.execute).not.toHaveBeenCalled();
    fireEvent.click(box);
    expect((install as HTMLButtonElement).disabled).toBe(false);
    await act(async () => void fireEvent.click(install));
    expect(api.execute).toHaveBeenCalledExactlyOnceWith(plan.id, 'install');
  });

  it('무료가 확인된 카드에는 체크 상자가 없다', () => {
    render(<InstallPlanCard plan={fixturePlan()} />);
    expect(screen.queryByRole('checkbox')).toBeNull();
  });
});

describe('P2-D.6 버튼 [설치] [다른 방법 보기] [취소], 실행 명령 원문은 접힘', () => {
  it('스냅샷 + 버튼 동작', async () => {
    const plan = fixturePlan();
    const api = { execute: execOk() };
    const onAlternatives = vi.fn();
    const onClose = vi.fn();
    const { container } = render(
      <InstallPlanCard plan={plan} api={api} onAlternatives={onAlternatives} onClose={onClose} />,
    );
    const el = cardEl(plan);
    const labels = within(el)
      .getAllByRole('button')
      .filter((b) => b.dataset.choice)
      .map((b) => b.textContent?.replace(/^[①-⑳]\s*/, ''));
    expect(labels).toEqual(['설치', '다른 방법 보기', '취소']);
    expect(el.textContent).not.toContain('winget install');
    expect(screen.queryByTestId('action-card-technical')).toBeNull();
    expect(container.innerHTML).toMatchSnapshot();
    fireEvent.click(within(el).getByRole('button', { name: /자세히 보기/ }));
    expect(screen.getByTestId('action-card-technical').textContent).toContain(
      'winget install --id Gyan.FFmpeg -e --silent --accept-package-agreements --accept-source-agreements',
    );
    fireEvent.click(within(el).getByRole('button', { name: /다른 방법 보기/ }));
    expect(onAlternatives).toHaveBeenCalledWith(plan);
    fireEvent.click(within(el).getByRole('button', { name: /취소/ }));
    expect(onClose).toHaveBeenCalledWith(plan);
    expect(api.execute).not.toHaveBeenCalled();
  });
});

describe('P2-D.7 관리자 권한 필요: "윈도우가 허락을 물어볼 거예요(예 누르기)" + 대기 표시', () => {
  it('스냅샷: 안내 → [설치] 누르면 대기 표시', async () => {
    const plan = fixturePlan({ id: 'plan_admin', needsAdmin: true });
    let resolve!: (v: { id: string; planId: string; action: 'install'; status: string }) => void;
    const api = { execute: vi.fn(() => new Promise<never>((r) => (resolve = r as never))) };
    const { container } = render(<InstallPlanCard plan={plan} api={api} />);
    const el = cardEl(plan);
    expect(el.textContent).toContain(ADMIN_TEXT);
    expect(screen.queryByText(ADMIN_WAITING_TEXT, { exact: false })).toBeNull();
    await act(async () => void fireEvent.click(within(el).getByRole('button', { name: /설치/ })));
    const status = within(el).getByRole('status');
    expect(status.textContent).toContain(ADMIN_WAITING_TEXT);
    expect(container.innerHTML).toMatchSnapshot();
    await act(async () => resolve({ id: 'j', planId: plan.id, action: 'install', status: 'running' }));
    expect(within(el).getByRole('status').textContent).toContain(ADMIN_WAITING_TEXT);
    expect(checkPlainKorean(ADMIN_TEXT).ok && checkPlainKorean(ADMIN_WAITING_TEXT).ok).toBe(true);
  });

  it('관리자 권한이 필요 없으면 "필요 없어요"이고 대기 표시는 일반 안내', async () => {
    const plan = fixturePlan();
    const api = { execute: execOk() };
    render(<InstallPlanCard plan={plan} api={api} />);
    const el = cardEl(plan);
    expect(el.textContent).not.toContain(ADMIN_TEXT);
    await act(async () => void fireEvent.click(within(el).getByRole('button', { name: /설치/ })));
    expect(within(el).getByRole('status').textContent).not.toContain(ADMIN_WAITING_TEXT);
  });
});
