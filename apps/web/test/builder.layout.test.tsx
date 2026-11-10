// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { BuilderPage } from '../src/builder/BuilderPage.js';
import { DEFAULT_CATALOG } from '../src/builder/catalog.js';
import { mockReactFlowDom } from './flow-mock.js';

beforeAll(mockReactFlowDom);
afterEach(cleanup);

describe('44.3 3열 레이아웃 (컨셉 C)', () => {
  it('서랍(좌) / 캔버스(중, React Flow, 16px 그리드) / 인스펙터(우) 스냅샷', () => {
    const { container } = render(<BuilderPage route="/builder/new" catalog={DEFAULT_CATALOG} />);
    fireEvent.click(screen.getByText('플러그인에서 시작'));
    fireEvent.click(screen.getByText('코드 리뷰'));
    const cols = container.querySelector('.hx-builder__cols')!;
    expect(Array.from(cols.children).map((c) => c.getAttribute('aria-label'))).toEqual([
      '블록 서랍',
      '캔버스',
      '인스펙터',
    ]);
    expect(cols.querySelector('.react-flow')).toBeTruthy();
    // 배경 점 격자 간격 16px
    expect(cols.querySelector('.react-flow__background pattern')?.getAttribute('width')).toBe('16');
    expect(cols.querySelectorAll('.react-flow__node')).toHaveLength(2);
    expect(container.innerHTML).toMatchSnapshot();
  });
});
