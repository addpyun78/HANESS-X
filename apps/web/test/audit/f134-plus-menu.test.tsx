// @vitest-environment jsdom
// @features F-134
// T-102 B.23.F-134 기능 고정: + 메뉴의 최근 프로젝트 고르기·고정(★)·폴더 열기·파일 첨부가 지금처럼 동작한다
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlusMenu } from '../../src/composer/PlusMenu.js';

afterEach(cleanup);
const RECENT = [
  { name: 'alpha', path: '/w/alpha', pinned: true },
  { name: 'beta', path: '/w/beta' },
];

describe('F-134 + 메뉴 (현재 동작 고정)', () => {
  it('최근 프로젝트를 펼쳐 고정 버튼을 누르면 그 프로젝트로 onTogglePin, 메뉴는 열린 채', () => {
    const onTogglePin = vi.fn();
    const onClose = vi.fn();
    render(<PlusMenu recent={RECENT} onTogglePin={onTogglePin} onClose={onClose} />);
    fireEvent.click(screen.getByRole('menuitem', { name: /최근 프로젝트/ }));
    const pinBeta = screen.getByLabelText('beta 고정');
    expect(pinBeta.getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByLabelText('alpha 고정 해제').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(pinBeta);
    expect(onTogglePin).toHaveBeenCalledWith(RECENT[1]);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('최근 프로젝트 고르기 → 메뉴 닫고 onPickRecent', () => {
    const onPickRecent = vi.fn();
    const onClose = vi.fn();
    render(<PlusMenu recent={RECENT} onPickRecent={onPickRecent} onClose={onClose} mobile />);
    fireEvent.click(screen.getByTitle('/w/beta'));
    expect(onClose).toHaveBeenCalledOnce();
    expect(onPickRecent).toHaveBeenCalledWith(RECENT[1]);
  });

  it('폴더 열기·파일 첨부 → 메뉴 닫고 각 처리 함수, 최근이 없으면 빈 안내', () => {
    const onOpenFolder = vi.fn();
    const onAttachFiles = vi.fn();
    const onClose = vi.fn();
    render(
      <PlusMenu recent={[]} onOpenFolder={onOpenFolder} onAttachFiles={onAttachFiles} onClose={onClose} />,
    );
    fireEvent.click(screen.getByRole('menuitem', { name: /프로젝트 폴더 열기/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: /파일 첨부/ }));
    expect(onOpenFolder).toHaveBeenCalledOnce();
    expect(onAttachFiles).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('menuitem', { name: /최근 프로젝트/ }));
    expect(screen.getByText('최근 프로젝트가 없습니다')).toBeTruthy();
  });
});
