// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useIsMobile } from '../src/shell/mobile.js';
import { renderComposer } from './composer.helpers.js';

afterEach(cleanup);
beforeEach(() => {
  // jsdom에는 object URL이 없다
  URL.createObjectURL = vi.fn((f: Blob) => `blob:${(f as File).name}`);
  URL.revokeObjectURL = vi.fn();
});

describe('1E.7 모바일: 끌어 놓기 대신 파일 선택 버튼 (뷰포트)', () => {
  function mockViewport(width: number, coarse: boolean) {
    window.matchMedia = ((q: string) => ({
      matches:
        width <= Number(/max-width:\s*([\d.]+)px/.exec(q)?.[1] ?? Infinity) && (!/coarse/.test(q) || coarse),
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
  }
  function Probe() {
    return <span data-testid="probe">{String(useIsMobile())}</span>;
  }

  it('375px 터치 화면이면 "파일 선택" 버튼, 넓은 화면이면 없음', () => {
    mockViewport(375, true);
    render(<Probe />);
    expect(screen.getByTestId('probe').textContent).toBe('true');
    cleanup();

    const { container } = renderComposer({ plusMenu: { recent: [], mobile: true } });
    const pick = screen.getByRole('button', { name: '파일 선택' });
    const input = screen.getByTestId('attach-input') as HTMLInputElement;
    const click = vi.spyOn(input, 'click');
    fireEvent.click(pick);
    expect(click).toHaveBeenCalledOnce();
    expect(container.querySelector('[role="toolbar"]')!.innerHTML).toMatchSnapshot();
    cleanup();

    mockViewport(1280, false);
    render(<Probe />);
    expect(screen.getByTestId('probe').textContent).toBe('false');
    renderComposer({ plusMenu: { recent: [] } });
    expect(screen.queryByRole('button', { name: '파일 선택' })).toBeNull();
  });
});
