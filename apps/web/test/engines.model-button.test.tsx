// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Composer } from '../src/composer/Composer.js';
import type { EngineScanApi } from '../src/engines/api.js';
import {
  applyModelChoice,
  mainAiInputs,
  mainAiStatus,
  PICK_OTHER,
  type AiChoice,
} from '../src/engines/model.js';
import { ModelButton } from '../src/engines/ModelButton.js';
import { useEngines } from '../src/engines/useEngines.js';
import type { ProjectDefaults } from '../src/engines/useMainAi.js';
import { ENGINES } from './composer.helpers.js';
import { done, fakeScanApi, MODELS } from './engines-fixtures.js';

afterEach(cleanup);

function Screen({
  api,
  project,
  sessionId,
  onSend = () => {},
  onLogin,
}: {
  api: EngineScanApi;
  project?: ProjectDefaults;
  sessionId?: string;
  onSend?: (p: unknown) => void;
  onLogin?: (id: string) => void;
}) {
  const e = useEngines({
    api,
    ...(project ? { project } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(onLogin ? { onLogin } : {}),
  });
  return <Composer engines={ENGINES} onSend={onSend} modelPicker={e.button} ai={e.main.current} />;
}

const openMenu = async (label = 'AI: claude-code · sonnet') => {
  fireEvent.click(await screen.findByLabelText(label));
  return screen.getByRole('menu', { name: 'AI 고르기' });
};

describe('T-101 5C 입력창 오른쪽 아래 모델 선택 = 메인 AI', () => {
  it('5C.1 아래 줄: [+] [권한 ▾] … [엔진 · 모델 ▾] [↑] — 왼쪽 엔진 칩·인증 칩 없음 (스냅샷)', async () => {
    const { container } = render(<Screen api={fakeScanApi([done()])} />);
    await screen.findByLabelText('AI: claude-code · sonnet');
    const bar = container.querySelector('.hx-composer__bar')!;
    const slots = [...bar.children].map(
      (el) =>
        el.getAttribute('data-slot') ??
        (el.classList.contains('hx-composer__spacer') ? 'spacer' : null) ??
        [...el.classList].find((c) => c.startsWith('hx-chip--') || c === 'hx-send') ??
        el.className,
    );
    expect(slots).toEqual(['plus', 'hx-chip--permission', 'spacer', 'model', 'hx-send']);
    expect(container.querySelector('.hx-chip--engine')).toBeNull();
    expect(container.querySelector('.hx-chip--auth')).toBeNull();
    expect(bar.outerHTML).toMatchSnapshot();
  });

  it('5C.2 펼침 목록: 엔진별 묶음 · [구독]/[API]/[무료 로컬] 배지 · 이미지 아이콘 · 로그인 필요는 흐리게 + [로그인] (스냅샷)', async () => {
    const onLogin = vi.fn();
    render(<Screen api={fakeScanApi([done()])} onLogin={onLogin} />);
    const menu = await openMenu();
    expect(
      within(menu)
        .getAllByRole('group')
        .map((g) => g.getAttribute('aria-label')),
    ).toEqual(['Claude Code', 'Codex', 'Ollama']);
    const items = within(menu).getAllByRole('menuitemradio');
    expect(items.map((i) => i.textContent)).toEqual([
      '✓Sonnet구독🖼',
      'Opus구독🖼',
      'gpt-5.5-codex구독🖼',
      'llama3무료 로컬',
    ]);
    expect(items[2]!.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(items[2]!); // 흐린 항목은 고를 수 없다
    expect(within(menu).queryByRole('group', { name: '어디에 쓸까요' })).toBeNull();
    fireEvent.click(within(menu).getByRole('button', { name: '로그인' }));
    expect(onLogin).toHaveBeenCalledWith('codex');
    expect(menu.outerHTML).toMatchSnapshot();
  });

  it('5C.3 고른 것이 메인 AI: PUT /api/main-ai, 보내는 지시의 엔진도 바뀜', async () => {
    const api = fakeScanApi([done()]);
    const onSend = vi.fn();
    render(<Screen api={api} onSend={onSend} />);
    const menu = await openMenu();
    fireEvent.click(within(menu).getByText('llama3'));
    fireEvent.click(within(menu).getByRole('button', { name: '모든 곳 기본(메인)으로 (기본)' }));
    await waitFor(() => expect(api.setMainAi).toHaveBeenCalledWith({ engine: 'ollama', model: 'llama3' }));
    await screen.findByLabelText('AI: ollama · llama3');
    fireEvent.change(screen.getByLabelText('지시 입력'), { target: { value: '안녕' } });
    fireEvent.keyDown(screen.getByLabelText('지시 입력'), { key: 'Enter' });
    expect((onSend.mock.calls[0]![0] as { settings: { engineId: string } }).settings.engineId).toBe('ollama');
  });

  it('5C.3b 프로젝트 기본 AI가 있으면 그것으로 시작 + "이 프로젝트 기본" 표시, 3가지 범위 (모든 곳 / 이 프로젝트 / 이 세션만)', async () => {
    let projectAi: AiChoice | undefined = { engine: 'claude-code', model: 'opus' };
    const project: ProjectDefaults = { get: () => projectAi, set: vi.fn((c: AiChoice) => (projectAi = c)) };
    const api = fakeScanApi([done()]);
    render(<Screen api={api} project={project} sessionId="s1" />);
    await screen.findByLabelText('AI: claude-code · opus (이 프로젝트 기본)');
    expect(screen.getByText('이 프로젝트 기본')).toBeTruthy();

    // ① 이 프로젝트 기본으로
    let menu = await openMenu('AI: claude-code · opus (이 프로젝트 기본)');
    fireEvent.click(within(menu).getByText('Sonnet'));
    const scope = within(menu).getByRole('group', { name: '어디에 쓸까요' });
    expect(
      within(scope)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['모든 곳 기본(메인)으로 (기본)', '이 프로젝트 기본으로', '이 세션만']);
    expect(document.activeElement?.textContent).toBe('모든 곳 기본(메인)으로 (기본)');
    fireEvent.click(within(scope).getByText('이 프로젝트 기본으로'));
    await screen.findByLabelText('AI: claude-code · sonnet (이 프로젝트 기본)');
    expect(project.set).toHaveBeenCalledWith({ engine: 'claude-code', model: 'sonnet' });
    expect(api.setMainAi).not.toHaveBeenCalled();

    // ② 이 세션만 → PUT /api/sessions/s1/ai, 프로젝트·메인 불변
    menu = await openMenu('AI: claude-code · sonnet (이 프로젝트 기본)');
    fireEvent.click(within(menu).getByText('llama3'));
    fireEvent.click(within(menu).getByText('이 세션만'));
    await screen.findByLabelText('AI: ollama · llama3');
    expect(api.setSessionAi).toHaveBeenCalledWith('s1', { engine: 'ollama', model: 'llama3' });
    expect(project.set).toHaveBeenCalledTimes(1);
    expect(api.setMainAi).not.toHaveBeenCalled();

    // ③ 모든 곳 기본(메인) → PUT /api/main-ai, 이 세션만 고른 것은 풀림 → 다시 프로젝트 기본
    menu = await openMenu('AI: ollama · llama3');
    fireEvent.click(within(menu).getByText('Opus'));
    fireEvent.click(within(menu).getByText('모든 곳 기본(메인)으로 (기본)'));
    await waitFor(() => expect(api.setMainAi).toHaveBeenCalledWith({ engine: 'claude-code', model: 'opus' }));
    await screen.findByLabelText('AI: claude-code · sonnet (이 프로젝트 기본)');
  });

  it('5C.3b 범위 적용 함수: 프로젝트 기능이 없으면 "이 프로젝트"는 메인으로', async () => {
    const t = { setMain: vi.fn(), setSession: vi.fn(), setProjectDefault: vi.fn() };
    const c = { engine: 'codex' };
    expect(await applyModelChoice('main', c, t)).toBe('main');
    expect(await applyModelChoice('project', c, t)).toBe('project');
    expect(await applyModelChoice('session', c, t)).toBe('session');
    expect([
      t.setMain.mock.calls.length,
      t.setProjectDefault.mock.calls.length,
      t.setSession.mock.calls.length,
    ]).toEqual([1, 1, 1]);
    expect(await applyModelChoice('project', c, { setMain: t.setMain, setSession: t.setSession })).toBe(
      'main',
    );
  });

  it('5C.6 메인 AI가 쓸 수 없게 되면(로그아웃·삭제) 노란 경고 + "다른 AI를 골라 주세요"', () => {
    const main = { engine: 'claude-code', model: 'sonnet' };
    expect(mainAiStatus(main, MODELS)).toBe('ok');
    const loggedOut = MODELS.map((m) =>
      m.engineId === 'claude-code' ? { ...m, status: 'needs-login' as const } : m,
    );
    const removed = MODELS.filter((m) => m.engineId !== 'claude-code');
    expect(mainAiStatus(main, loggedOut)).toBe('needs-login');
    expect(mainAiStatus(main, removed)).toBe('missing');
    expect(mainAiStatus(undefined, MODELS)).toBe('unset');

    function Live() {
      const [models, setModels] = useState(MODELS);
      return (
        <>
          <button type="button" onClick={() => setModels(loggedOut)}>
            로그아웃
          </button>
          <button type="button" onClick={() => setModels(removed)}>
            삭제
          </button>
          <ModelButton models={models} current={main} onChoose={() => {}} />
        </>
      );
    }
    render(<Live />);
    const chip = screen.getByLabelText('AI: claude-code · sonnet');
    expect(chip.hasAttribute('data-warn')).toBe(false);
    expect(screen.queryByText(`⚠ ${PICK_OTHER}`)).toBeNull();
    act(() => fireEvent.click(screen.getByText('로그아웃')));
    expect(chip.getAttribute('data-warn')).toBe('true');
    expect(screen.getByText(`⚠ ${PICK_OTHER}`)).toBeTruthy();
    act(() => fireEvent.click(screen.getByText('삭제')));
    expect(screen.getByText(`⚠ ${PICK_OTHER}`)).toBeTruthy();
  });

  it('5D.7a 메인 AI 기준 입력 능력: 메인을 바꾸면 결과가 바뀐다 (첨부 안내 문구가 쓸 값)', () => {
    expect(mainAiInputs({ engine: 'claude-code', model: 'sonnet' }, MODELS)).toEqual({
      image: true,
      pdf: true,
      audio: false,
    });
    expect(mainAiInputs({ engine: 'ollama', model: 'llama3' }, MODELS)).toEqual({
      image: false,
      pdf: false,
      audio: false,
    });
    expect(mainAiInputs({ engine: 'nope' }, MODELS)).toBeUndefined();
  });
});
