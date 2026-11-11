// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { BuilderPage } from '../src/builder/BuilderPage.js';
import { DEFAULT_CATALOG } from '../src/builder/catalog.js';
import { mockReactFlowDom } from './flow-mock.js';

beforeAll(mockReactFlowDom);
afterEach(cleanup);

const modeTabs = () => within(screen.getByRole('tablist', { name: '만들기 방식' })).getAllByRole('tab');
const selected = () => modeTabs().find((t) => t.getAttribute('aria-selected') === 'true')?.textContent;

describe('P4-B.2 왼쪽 서랍 탭 `블록 | 대화로 만들기`', () => {
  it('탭 전환: 블록 ↔ 대화(채팅 형태), 입력 내용은 탭을 바꿔도 남음', () => {
    render(<BuilderPage route="/builder/new" catalog={DEFAULT_CATALOG} />);
    fireEvent.click(screen.getByText('빈 캔버스'));
    expect(modeTabs().map((t) => t.textContent)).toEqual(['블록', '💬 대화로 만들기']);
    expect(selected()).toBe('블록');
    expect(screen.getByRole('searchbox', { name: '블록 검색' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: '대화로 만들기' })).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: /대화로 만들기/ }));
    expect(selected()).toBe('💬 대화로 만들기');
    const chat = screen.getByRole('region', { name: '대화로 만들기' });
    expect(within(chat).getByRole('list', { name: '대화' })).toBeTruthy();
    expect(screen.queryByRole('searchbox', { name: '블록 검색' })).toBeNull();
    fireEvent.change(screen.getByLabelText('설명 입력'), { target: { value: '쓰다 만 글' } });

    fireEvent.click(screen.getByRole('tab', { name: '블록' }));
    expect(selected()).toBe('블록');
    expect(screen.getByRole('searchbox', { name: '블록 검색' })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: /대화로 만들기/ }));
    expect((screen.getByLabelText('설명 입력') as HTMLTextAreaElement).value).toBe('쓰다 만 글');
  });

  it('"말이나 글로 설명해서 만들기"로 시작하면 대화 탭이 열린다', () => {
    render(<BuilderPage route="/builder/new" catalog={DEFAULT_CATALOG} />);
    fireEvent.click(screen.getByText('말이나 글로 설명해서 만들기'));
    expect(selected()).toBe('💬 대화로 만들기');
    expect(screen.getByLabelText('설명 입력')).toBeTruthy();
  });

  it('블록 탭은 기존 서랍 그대로 (노드·플러그인·스킬·엔진·도구)', () => {
    render(<BuilderPage route="/builder/new" catalog={DEFAULT_CATALOG} />);
    fireEvent.click(screen.getByText('빈 캔버스'));
    expect(
      within(screen.getByRole('tablist', { name: '블록 종류' }))
        .getAllByRole('tab')
        .map((t) => t.textContent),
    ).toHaveLength(5);
  });
});
