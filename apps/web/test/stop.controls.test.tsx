// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkPlainKorean } from './plain-check.js';
import { StopAllButton } from '../src/shell/StopAllButton.js';
import { TopBar } from '../src/shell/TopBar.js';
import { renderComposer } from './composer.helpers.js';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const stop = (running = true) => ({ running, onPause: vi.fn(), onStopNow: vi.fn() });

describe('2A.8 실행 중 전송 버튼 → [■ 정지]', () => {
  it('실행 중이 아니면 전송(↑), 실행 중이면 [■ 정지] (스냅샷)', () => {
    renderComposer({ stop: stop(false) });
    expect(screen.getByRole('button', { name: '전송' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '정지' })).toBeNull();
    cleanup();
    renderComposer({ stop: stop(true) });
    expect(screen.queryByRole('button', { name: '전송' })).toBeNull();
    const btn = screen.getByRole('button', { name: '정지' });
    expect(btn.outerHTML).toMatchInlineSnapshot(
      `"<button type="button" class="hx-send hx-send--stop" aria-label="정지" aria-haspopup="menu" aria-expanded="false" data-action="composer.stop">■ 정지</button>"`,
    );
  });

  it('누르면 [일시정지] [지금 멈추기] 메뉴, 각각 호출', () => {
    const s = stop();
    renderComposer({ stop: s });
    fireEvent.click(screen.getByRole('button', { name: '정지' }));
    const items = screen.getAllByRole('menuitem');
    expect(items.map((i) => i.textContent)).toEqual(['⏸ 일시정지', '⏹ 지금 멈추기']);
    expect(screen.getByRole('menu').outerHTML).toMatchInlineSnapshot(
      `"<span class="hx-stop__menu" role="menu" aria-label="정지 방법"><button type="button" role="menuitem" title="하던 일을 마무리하기 좋은 때에 멈춰요" data-action="composer.stop-pause">⏸ 일시정지</button><button type="button" role="menuitem" title="바로 멈춰요 (Esc 두 번)" data-action="composer.stop-now">⏹ 지금 멈추기</button></span>"`,
    );
    fireEvent.click(items[0]!);
    expect(s.onPause).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '정지' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '⏹ 지금 멈추기' }));
    expect(s.onStopNow).toHaveBeenCalledOnce();
  });

  it('키보드: Esc 두 번 = 지금 멈추기, 한 번·느린 두 번·한글 조합 중 Esc는 아님', () => {
    vi.useFakeTimers();
    const s = stop();
    renderComposer({ stop: s });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(s.onStopNow).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(s.onStopNow).not.toHaveBeenCalled(); // 1초 간격 = 따로 누른 것
    vi.advanceTimersByTime(300);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(s.onStopNow).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(2000);
    fireEvent.keyDown(document, { key: 'Escape', isComposing: true });
    fireEvent.keyDown(document, { key: 'Escape', isComposing: true });
    expect(s.onStopNow).toHaveBeenCalledOnce();
  });

  it('실행 중이 아니면 Esc 두 번에 반응 없음', () => {
    const s = stop(false);
    renderComposer({ stop: s });
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(s.onStopNow).not.toHaveBeenCalled();
  });
});

describe('2A.8 상단 바 [전체 정지]', () => {
  it('실행 세션 2개 이상일 때만 보임 (스냅샷), 누르면 호출', () => {
    const onStopAll = vi.fn();
    const { rerender } = render(
      <TopBar
        runState="running"
        quotas={[]}
        actions={<StopAllButton runningCount={1} onStopAll={onStopAll} />}
      />,
    );
    expect(screen.queryByRole('button', { name: /전체 정지/ })).toBeNull();
    rerender(
      <TopBar
        runState="running"
        quotas={[]}
        actions={<StopAllButton runningCount={2} onStopAll={onStopAll} />}
      />,
    );
    const b = screen.getByRole('button', { name: '전체 정지 (실행 중 2개)' });
    expect(b.outerHTML).toMatchInlineSnapshot(
      `"<button type="button" class="hx-stop-all" data-action="shell.stop-all" aria-label="전체 정지 (실행 중 2개)">■ 전체 정지</button>"`,
    );
    fireEvent.click(b);
    expect(onStopAll).toHaveBeenCalledOnce();
  });

  it('버튼 글은 쉬운 말', () => {
    for (const t of ['일시정지', '지금 멈추기', '전체 정지', '하던 일을 마무리하기 좋은 때에 멈춰요'])
      expect(checkPlainKorean(t, { label: true }).ok).toBe(true);
  });
});
