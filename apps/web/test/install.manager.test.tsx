// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InstallApi } from '../src/install/api.js';
import { INSTALL_TABS, InstallManager, filterRows } from '../src/install/InstallManager.js';
import type { CandidateView, InstallLogRecordView, InstallPlanView } from '../src/install/model.js';
import { Sidebar } from '../src/shell/Sidebar.js';
import { fixturePlan, fixtureTool } from './install-fixtures.js';

afterEach(cleanup);

function fakeApi(over: Partial<InstallApi> = {}): InstallApi & { calls: string[] } {
  const calls: string[] = [];
  const log =
    <A extends unknown[], R>(name: string, fn: (...a: A) => R) =>
    (...a: A) => (calls.push(`${name}${a.length ? ` ${JSON.stringify(a)}` : ''}`), fn(...a));
  const api: InstallApi = {
    search: log('search', async (query: string) => ({ query, candidates: [] as CandidateView[] })),
    resolve: log('resolve', async (url: string) => ({ input: url, candidates: [] })),
    plan: log('plan', async (r: { kind: CandidateView['kind']; target: CandidateView['target'] }) =>
      fixturePlan({ id: `plan_${r.target.id}`, kind: r.kind, name: r.target.id, target: r.target.id }),
    ),
    getPlan: log('getPlan', async (id: string) => fixturePlan({ id })),
    execute: log('execute', async () => {
      throw new Error('실행은 이 화면에서 하지 않는다');
    }),
    cancel: log('cancel', async () => ({})),
    uninstallPlan: log('uninstallPlan', async (toolId: string) =>
      fixturePlan({ id: `un_${toolId}`, action: 'uninstall', toolId }),
    ),
    updates: log('updates', async () => ({
      checkedAt: '',
      skipped: false,
      updates: [] as InstallPlanView[],
    })),
    tools: log('tools', async () => ({ tools: [] })),
    history: log('history', async () => ({ records: [] as InstallLogRecordView[] })),
  };
  for (const [k, fn] of Object.entries(over))
    (api as unknown as Record<string, unknown>)[k] = log(k, fn as (...a: unknown[]) => unknown);
  return Object.assign(api, { calls });
}

const sink = () => ({ add: vi.fn(), addFailure: vi.fn() });

describe('P2-G.1 사이드바 하단 메뉴에 "설치 관리"', () => {
  it('스냅샷 + 누르면 install로 이동', () => {
    const onNav = vi.fn();
    const { container } = render(<Sidebar groups={[]} onNavigate={onNav} />);
    const menu = within(screen.getByRole('menu', { name: '하단 메뉴' }));
    const items = menu.getAllByRole('menuitem').map((b) => b.textContent);
    expect(items).toContain('⬇설치 관리');
    fireEvent.click(menu.getByRole('menuitem', { name: /설치 관리/ }));
    expect(onNav).toHaveBeenCalledWith('install');
    expect(container.querySelector('.hx-sidebar__nav')!.outerHTML).toMatchSnapshot();
  });
});

describe('P2-G.2 탭 [설치됨] [찾기] [주소로 설치] [기록]', () => {
  it('탭 전환 (클릭·화살표 키)', async () => {
    const api = fakeApi();
    render(<InstallManager api={api} cards={sink()} />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['설치됨', '찾기', '주소로 설치', '기록']);
    expect(INSTALL_TABS.map((t) => t.label)).toEqual(['설치됨', '찾기', '주소로 설치', '기록']);
    const selected = () =>
      screen.getAllByRole('tab').find((t) => t.getAttribute('aria-selected') === 'true')!.textContent;
    expect(selected()).toBe('설치됨');
    await waitFor(() => expect(api.calls).toContain('tools'));
    fireEvent.click(screen.getByRole('tab', { name: '찾기' }));
    expect(selected()).toBe('찾기');
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe('hx-install-tab-search');
    expect(screen.getByRole('searchbox', { name: '찾을 도구 이름' })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: '주소로 설치' }));
    expect(screen.getByRole('textbox', { name: '설치할 주소' })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: '기록' }));
    await waitFor(() => expect(api.calls).toContain('history'));
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
    expect(selected()).toBe('설치됨');
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowLeft' });
    expect(selected()).toBe('기록');
  });
});

describe('P2-G.3 [설치됨]: 이름·무료/유료 배지·종류·버전·[업데이트]·[지우기]', () => {
  it('스냅샷 + [지우기]는 제거 계획 카드, [업데이트]는 업데이트 계획 카드 (실행 0건)', async () => {
    const tools = [
      fixtureTool(),
      fixtureTool({
        id: 'ollama-model:qwen3-coder:14b',
        name: 'qwen3-coder',
        kind: 'ollama-model',
        version: '14B',
      }),
      fixtureTool({
        id: 'api-service:brave-search',
        name: 'brave-search',
        kind: 'api-service',
        version: '',
        pricing: { tier: 'freemium', note: '', checkedAt: '', sourceUrl: '' },
        origin: 'imported',
      }),
    ];
    const up = fixturePlan({
      id: 'up_ffmpeg',
      action: 'update',
      toolId: 'winget:Gyan.FFmpeg',
      version: '7.2',
    });
    const api = fakeApi({
      tools: async () => ({ tools }),
      updates: async () => ({ checkedAt: '', skipped: false, updates: [up] }),
    });
    const cards = sink();
    const { container } = render(<InstallManager api={api} cards={cards} />);
    const list = await screen.findByRole('list', { name: '설치된 도구' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    const ff = within(rows[0]!);
    expect(ff.getByText('ffmpeg')).toBeTruthy();
    expect(ff.getByText('[무료]').dataset.tone).toBe('green');
    expect(ff.getByText('윈도우 앱')).toBeTruthy();
    expect(ff.getByText('7.1')).toBeTruthy();
    expect(within(rows[2]!).getByText('[무료+유료 기능]').dataset.tone).toBe('blue');
    expect(container.innerHTML).toMatchSnapshot();
    await act(async () => void fireEvent.click(ff.getByRole('button', { name: '지우기' })));
    expect(cards.add).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'un_winget:Gyan.FFmpeg', action: 'uninstall' }),
    );
    await act(async () => void fireEvent.click(ff.getByRole('button', { name: '업데이트' })));
    expect(cards.add).toHaveBeenLastCalledWith(up);
    await act(async () => void fireEvent.click(within(rows[1]!).getByRole('button', { name: '업데이트' })));
    expect(await screen.findByText('"qwen3-coder"은(는) 최신 버전이에요.')).toBeTruthy();
    expect(api.calls.filter((c) => c.startsWith('execute'))).toEqual([]);
    expect(api.calls.filter((c) => c === 'updates')).toHaveLength(1);
  });
});

describe('P2-G.4 [찾기]: 검색창 + 종류 필터 + 무료/유료 필터 → 고르면 계획 카드', () => {
  const cands: CandidateView[] = [
    {
      kind: 'winget',
      target: { id: 'Gyan.FFmpeg', name: 'FFmpeg' },
      label: 'FFmpeg (윈도우 앱 저장소)',
      source: 'winget',
    },
    { kind: 'npm-cli', target: { id: 'ffmpeg-cli' }, label: 'npm 명령줄 도구 ffmpeg-cli', source: 'npm-cli' },
    {
      kind: 'python-cli',
      target: { id: 'ffmpeg-py' },
      label: 'Python 명령줄 도구 ffmpeg-py',
      source: 'python-cli',
    },
  ];
  const tierOf: Record<string, 'free' | 'paid' | 'unknown'> = {
    'Gyan.FFmpeg': 'free',
    'ffmpeg-cli': 'paid',
    'ffmpeg-py': 'unknown',
  };

  it('필터 테스트: 종류·무료/유료로 좁히고, 고른 결과만 카드로', async () => {
    const api = fakeApi({
      search: async (query) => ({ query, candidates: cands }),
      plan: async (r) =>
        fixturePlan({
          id: `plan_${r.target.id}`,
          kind: r.kind,
          name: r.target.id,
          target: r.target.id,
          tier: tierOf[r.target.id]!,
        }),
    });
    const cards = sink();
    render(<InstallManager api={api} cards={cards} initialTab="search" />);
    fireEvent.change(screen.getByRole('searchbox', { name: '찾을 도구 이름' }), {
      target: { value: 'ffmpeg' },
    });
    await act(async () => void fireEvent.click(screen.getByRole('button', { name: '찾기' })));
    const names = () =>
      within(screen.getByRole('list', { name: '찾은 도구' }))
        .getAllByRole('listitem')
        .map((li) => li.dataset.kind);
    await waitFor(() => expect(names()).toEqual(['winget', 'npm-cli', 'python-cli']));
    // 무료/유료 배지 (계획에서)
    expect(screen.getByText('[유료]').dataset.tone).toBe('red');
    fireEvent.change(screen.getByRole('combobox', { name: '무료/유료' }), { target: { value: 'free' } });
    expect(names()).toEqual(['winget']);
    fireEvent.change(screen.getByRole('combobox', { name: '무료/유료' }), { target: { value: 'all' } });
    fireEvent.change(screen.getByRole('combobox', { name: '종류' }), { target: { value: 'cli' } });
    expect(names()).toEqual(['npm-cli', 'python-cli']);
    fireEvent.change(screen.getByRole('combobox', { name: '무료/유료' }), { target: { value: 'unknown' } });
    expect(names()).toEqual(['python-cli']);
    fireEvent.change(screen.getByRole('combobox', { name: '무료/유료' }), { target: { value: 'paid' } });
    fireEvent.change(screen.getByRole('combobox', { name: '종류' }), { target: { value: 'app' } });
    expect(screen.getByText('조건에 맞는 도구가 없어요.')).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox', { name: '무료/유료' }), { target: { value: 'all' } });
    expect(cards.add).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '이걸로 설치' }));
    expect(cards.add).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 'plan_Gyan.FFmpeg' }));
  });

  it('filterRows 순수 함수', () => {
    const rows = cands.map((c) => ({ candidate: c, plan: { pricing: { tier: tierOf[c.target.id]! } } }));
    expect(filterRows(rows, 'all', 'free-first').map((r) => r.candidate.kind)).toEqual(['winget']);
    expect(filterRows(rows, 'cli', 'all')).toHaveLength(2);
    expect(filterRows([{ candidate: cands[0]! }], 'all', 'unknown')).toHaveLength(1);
  });
});

describe('P2-G.6 [기록]: installs.jsonl을 쉬운 말 목록으로', () => {
  it('스냅샷 (최근 것부터)', async () => {
    const records: InstallLogRecordView[] = [
      {
        ts: '2026-11-10T01:02:00.000Z',
        action: 'install',
        plan: { name: 'ffmpeg', kind: 'winget', action: 'install' },
        gestureId: 'g1',
        result: { ok: true, status: 'installed', message: '' },
      },
      {
        ts: '2026-11-10T02:00:00.000Z',
        action: 'install',
        plan: { name: 'qwen3-coder', kind: 'ollama-model', action: 'install' },
        gestureId: 'g2',
        result: { ok: false, status: 'verify-failed', message: '' },
      },
      {
        ts: '2026-11-10T03:00:00.000Z',
        action: 'uninstall',
        plan: { name: 'ffmpeg', kind: 'winget', action: 'uninstall' },
        gestureId: 'g3',
        result: { ok: true, status: 'removed', message: '' },
      },
      {
        ts: '2026-11-10T04:00:00.000Z',
        action: 'import',
        plan: null,
        toolId: 'npm-cli:prettier',
        gestureId: 'g4',
        result: { ok: true, status: 'installed', message: '' },
      },
    ];
    const api = fakeApi({ history: async () => ({ records }) });
    const { container } = render(<InstallManager api={api} cards={sink()} initialTab="history" />);
    const list = await screen.findByRole('list', { name: '설치 기록' });
    const texts = within(list)
      .getAllByRole('listitem')
      .map((li) => li.querySelector('span')!.textContent);
    expect(texts).toEqual([
      '"npm-cli:prettier" — 목록에 가져왔어요.',
      '"ffmpeg" (윈도우 앱) — 지웠어요.',
      '"qwen3-coder" (내 PC에서 도는 AI 모델) — 설치했지만 확인에 실패했어요.',
      '"ffmpeg" (윈도우 앱) — 설치했어요.',
    ]);
    expect(container.querySelectorAll('.hx-install__row--fail')).toHaveLength(1);
    // 시각은 지역 시간대에 따라 바뀌므로 스냅샷에서 뺀다
    container.querySelectorAll('time').forEach((t) => (t.textContent = '(시각)'));
    expect(container.innerHTML).toMatchSnapshot();
  });
});
