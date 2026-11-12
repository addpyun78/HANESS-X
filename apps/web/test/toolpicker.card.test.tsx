// @vitest-environment jsdom
// @features F-074 F-075 F-119
import { readFileSync } from 'node:fs';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActionCard } from '../src/panels/Approvals/ActionCard.js';
import { ApprovalsArea } from '../src/panels/Approvals/ApprovalsArea.js';
import { Toasts } from '../src/panels/Approvals/Toasts.js';
import { AppShell } from '../src/shell/AppShell.js';
import {
  installSelectedInOrder,
  openToolPickerForGap,
  openUrlInstall,
  URL_INSTALL_ROUTE,
  type ToolPickerApi,
} from '../src/panels/ToolPicker/api.js';
import {
  MissingPricingBadgeError,
  PRICING_BADGES,
  toolPickerToast,
  type PickerCandidateData,
  type ToolNeedData,
  type ToolPickerData,
} from '../src/panels/ToolPicker/model.js';
import {
  NOTHING_SELECTED,
  ToolPickerCard,
  toolPickerExtraCards,
} from '../src/panels/ToolPicker/ToolPickerCard.js';
import { fixtureCard } from './approvals-fixtures.js';
import { pickerCandidate, pickerData, TOOLPICKER_CSS_FILE } from './toolpicker-fixtures.js';

let width = 1280;
beforeEach(() => {
  width = 1280;
  window.matchMedia = ((q: string) => {
    const max = Number(/max-width:\s*([\d.]+)px/.exec(q)?.[1] ?? Infinity);
    return {
      get matches() {
        return width <= max;
      },
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
    } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;
});
afterEach(cleanup);

const rows = () => screen.getAllByRole('listitem');

describe('P3-C.3 도구 고르기 카드: 후보마다 이름·배지(필수)·설명·이유·아쉬운 점·설치·출처·확인 날짜, 추천 1개 ⭐', () => {
  it('설계서 화면 그대로 그린다', () => {
    render(<ToolPickerCard data={pickerData()} />);
    const card = screen.getByRole('group', { name: /이 작업에 도구가 필요해요/ });
    expect(card.textContent).toContain('🔧');
    expect(card.textContent).toContain('동영상에서 소리만 뽑아내기 (항목 4.2)');
    expect(rows()).toHaveLength(3);
    const [ff, hb, adobe] = rows();
    expect(within(ff!).getByText('[무료]').dataset.tone).toBe('green');
    expect(within(adobe!).getByText('[유료]').dataset.tone).toBe('red');
    expect(within(adobe!).getByText('월 구독이 필요해요.')).toBeTruthy();
    expect(ff!.textContent).toContain('왜 추천하나요? 가장 많이 쓰이고, 설치·삭제가 쉬워요.');
    expect(ff!.textContent).toContain('아쉬운 점: 화면 없이 명령으로만 써요.');
    expect(ff!.textContent).toContain('설치: Windows 공식 앱 저장소');
    expect(ff!.textContent).toContain('11/11 확인');
    expect(within(ff!).getByRole('link', { name: '출처 링크' }).getAttribute('href')).toBe(
      'https://example.org/ffmpeg',
    );
    expect(ff!.textContent).toContain('동영상·소리 변환 도구');
    expect(hb!.textContent).toContain('화면이 있어서 직접 눈으로 볼 수 있어요.');
    // ⭐ 추천은 정확히 1개, 처음에는 추천만 골라져 있다
    expect(screen.getAllByLabelText('추천')).toHaveLength(1);
    expect(within(ff!).getByLabelText('추천')).toBeTruthy();
    expect((within(ff!).getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
    expect((within(hb!).getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
    expect(screen.getAllByRole('button').map((b) => b.textContent?.replace(/^\S+\s/, ''))).toEqual([
      '선택한 걸로 설치',
      '주소 직접 넣기',
      '설치 없이 계속',
    ]);
  });

  it('배지 5종: Part 2 D.2와 같은 글자·색', () => {
    expect(
      Object.fromEntries(Object.entries(PRICING_BADGES).map(([k, v]) => [k, `${v.label}/${v.tone}`])),
    ).toEqual({
      free: '무료/green',
      freemium: '무료+유료 기능/blue',
      trial: '체험판/orange',
      paid: '유료/red',
      unknown: '무료인지 확인 못 했어요/yellow',
    });
    const tiers = ['free', 'freemium', 'trial', 'paid', 'unknown'] as const;
    render(
      <ToolPickerCard
        data={pickerData({
          candidates: tiers.map((t) =>
            pickerCandidate({
              id: t,
              name: t,
              pricing: { tier: t, note: '', sourceUrl: 'https://e.org', checkedAt: '' },
            }),
          ),
        })}
      />,
    );
    expect(rows().map((r) => r.querySelector('.hx-price-badge')!.className)).toEqual([
      'hx-price-badge hx-price-badge--green',
      'hx-price-badge hx-price-badge--blue',
      'hx-price-badge hx-price-badge--orange',
      'hx-price-badge hx-price-badge--red',
      'hx-price-badge hx-price-badge--yellow',
    ]);
    const css = readFileSync(TOOLPICKER_CSS_FILE, 'utf8');
    for (const tone of ['green', 'blue', 'orange', 'red', 'yellow'])
      expect(css).toContain(`.hx-price-badge--${tone}`);
  });

  it('배지 누락 시 렌더 오류', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const bad = pickerData();
    const broken = { ...bad.candidates[1]!, pricing: { ...bad.candidates[1]!.pricing, tier: undefined } };
    const data = { ...bad, candidates: [bad.candidates[0]!, broken] } as unknown as ToolPickerData;
    expect(() => render(<ToolPickerCard data={data} />)).toThrow(MissingPricingBadgeError);
    const noPricing = {
      ...bad,
      candidates: [{ ...bad.candidates[0]!, pricing: undefined }],
    } as unknown as ToolPickerData;
    expect(() => render(<ToolPickerCard data={noPricing} />)).toThrow(/배지가 없는 후보/);
    spy.mockRestore();
  });
});

describe('P3-C.4 여러 개 선택 → [선택한 걸로 설치]는 선택마다 Part 2 계획 카드를 순서대로', () => {
  it('2개 선택 시 카드 2장 (화면 순서대로)', async () => {
    const onInstall = vi.fn();
    const data = pickerData();
    render(<ToolPickerCard data={data} onInstallSelected={onInstall} />);
    fireEvent.click(within(rows()[1]!).getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /선택한 걸로 설치/ }));
    const chosen = onInstall.mock.calls[0]![0] as { id: string }[];
    expect(chosen.map((c) => c.id)).toEqual(['ffmpeg', 'handbrake']);

    const api: Pick<ToolPickerApi, 'planSelected'> = {
      planSelected: vi.fn(async (_n: ToolNeedData, cs: PickerCandidateData[]) => ({
        plans: cs.map((c) => ({ candidateId: c.id, plan: { id: `plan_${c.id}` } })),
      })),
    };
    const shown: unknown[] = [];
    const r = await installSelectedInOrder(api, data.need, chosen as never, (p) => shown.push(p));
    expect(r.shown).toBe(2);
    expect(shown).toEqual([{ id: 'plan_ffmpeg' }, { id: 'plan_handbrake' }]);
  });

  it('아무것도 안 고르면 설치 안 함 + 안내, 설치 방법 없는 후보는 건너뛰고 이유', async () => {
    const onInstall = vi.fn();
    render(<ToolPickerCard data={pickerData()} onInstallSelected={onInstall} />);
    fireEvent.click(within(rows()[0]!).getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /선택한 걸로 설치/ }));
    expect(onInstall).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe(NOTHING_SELECTED);
    const d = pickerData();
    const api: Pick<ToolPickerApi, 'planSelected'> = {
      planSelected: async () => ({
        plans: [{ candidateId: 'adobemediaencoder', reason: '공식 사이트에서 받아 주세요.' }],
      }),
    };
    const shown: unknown[] = [];
    const r = await installSelectedInOrder(api, d.need, [d.candidates[2]!], (p) => shown.push(p));
    expect(shown).toEqual([]);
    expect(r.skipped).toEqual([{ candidateId: 'adobemediaencoder', reason: '공식 사이트에서 받아 주세요.' }]);
  });
});

describe('P3-C.5 [주소 직접 넣기] → Part 2 C(주소로 설치)', () => {
  it('화면 이동: 콜백 호출, 기본 동작은 주소로 설치 경로로', () => {
    const onUrl = vi.fn();
    const onSkip = vi.fn();
    render(<ToolPickerCard data={pickerData()} onOpenUrlInstall={onUrl} onContinueWithout={onSkip} />);
    fireEvent.click(screen.getByRole('button', { name: /주소 직접 넣기/ }));
    expect(onUrl).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /설치 없이 계속/ }));
    expect(onSkip).toHaveBeenCalledTimes(1);
    location.hash = '';
    openUrlInstall();
    expect(location.hash).toBe(`#${URL_INSTALL_ROUTE}`);
    const nav = vi.fn();
    openUrlInstall(nav);
    expect(nav).toHaveBeenCalledWith('/install/url');
  });
});

describe('P3-C.8 카드는 Part 1 승인 카드 영역 재사용 (패널 상단·알림·배지·모바일)', () => {
  const shell = (extra = toolPickerExtraCards([pickerData()], () => ({}))) =>
    render(
      <AppShell
        topBar={{ runState: 'idle', quotas: [] }}
        sidebar={<nav aria-label="세션 사이드바">사이드</nav>}
        main={<div>채팅</div>}
        panelContent={{ checklist: <section aria-label="체크리스트">체크리스트 트리</section> }}
        panelTop={<ApprovalsArea cards={[fixtureCard('path-1')]} onChoose={() => {}} extraCards={extra} />}
      />,
    );

  it('같은 영역(패널 맨 위)·같은 ActionCard 틀·개수 배지에 함께 센다', () => {
    shell();
    const panel = screen.getByLabelText('우측 패널');
    const area = screen.getByRole('region', { name: '확인이 필요해요' });
    expect(panel.firstElementChild).toBe(area);
    expect(screen.getByLabelText('카드 2장').textContent).toBe('2');
    const cards = area.querySelectorAll('article.hx-action-card');
    expect(cards).toHaveLength(2);
    expect(within(cards[1] as HTMLElement).getByText(/이 작업에 도구가 필요해요/)).toBeTruthy();
    expect(area.dataset.variant).toBe('panel');
  });

  it('도구 고르기 카드만 있어도 영역이 뜨고, 좁은 화면은 하단 시트', () => {
    width = 500;
    render(<ApprovalsArea cards={[]} extraCards={toolPickerExtraCards([pickerData()], () => ({}))} />);
    const area = screen.getByRole('dialog', { name: '확인이 필요해요' });
    expect(area.dataset.variant).toBe('sheet');
    expect(area.querySelector('article.hx-action-card')).toBeTruthy();
  });

  it('같은 컴포넌트: ToolPickerCard는 ActionCard를 그대로 쓴다 (구조 동일), 알림도 같은 Toasts', () => {
    const { container: a } = render(
      <ActionCard card={{ id: 'x', title: 't', sections: [], buttons: [{ id: 'b', label: 'b' }] }} />,
    );
    const { container: b } = render(<ToolPickerCard data={pickerData()} />);
    const shape = (c: HTMLElement) =>
      [...c.querySelector('article')!.children]
        .map((e) => e.className)
        .filter((n) => n.startsWith('hx-action-card'));
    expect(shape(b)).toEqual(expect.arrayContaining(shape(a)));
    const onOpen = vi.fn();
    render(<Toasts toasts={[toolPickerToast(pickerData())]} onOpen={onOpen} onDismiss={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /도구가 필요해요: 동영상에서 소리만 뽑아내기/ }));
    expect(onOpen).toHaveBeenCalledWith('tool-picker-1');
  });
});

describe('P3-D.3 Part 4 에이전트 초안 빈 칸 [도구 찾기] → 도구 고르기 카드', () => {
  it('빈 칸 → nodeId와 능력 설명으로 찾기 → 카드 표시 (이미 있으면 카드 없이 알림)', async () => {
    const d = pickerData();
    const find = vi.fn(async () => ({
      status: 'candidates' as const,
      need: { ...d.need, requiredBy: { nodeId: 'n4' } },
      candidates: d.candidates,
      notices: [],
    }));
    const shownCards: ToolPickerData[] = [];
    const card = await openToolPickerForGap(
      { nodeId: 'n4', capability: 'PDF에서 표 뽑기' },
      { api: { find }, show: (c) => shownCards.push(c) },
    );
    expect(find).toHaveBeenCalledWith({ capability: 'PDF에서 표 뽑기', nodeId: 'n4' });
    expect(shownCards).toHaveLength(1);
    render(<ApprovalsArea cards={[]} extraCards={toolPickerExtraCards(shownCards, () => ({}))} />);
    expect(screen.getByText(/\(에이전트 칸 n4\)/)).toBeTruthy();
    expect(card!.id).toMatch(/^tool-picker-/);
    const onHave = vi.fn();
    const none = await openToolPickerForGap(
      { nodeId: 'n5', capability: '소리 뽑기' },
      {
        api: {
          find: async () => ({
            status: 'have' as const,
            need: d.need,
            tool: { id: 'winget:Gyan.FFmpeg', name: 'ffmpeg' },
            message: '이미 있는 도구를 쓸게요.',
          }),
        },
        show: (c) => shownCards.push(c),
        onHave,
      },
    );
    expect(none).toBeUndefined();
    expect(onHave).toHaveBeenCalledTimes(1);
    expect(shownCards).toHaveLength(1);
  });
});
