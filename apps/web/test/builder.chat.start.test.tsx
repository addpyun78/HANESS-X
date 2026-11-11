// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { BuilderPage } from '../src/builder/BuilderPage.js';
import { DEFAULT_CATALOG } from '../src/builder/catalog.js';
import { startGraph } from '../src/builder/start.js';
import { mockReactFlowDom } from './flow-mock.js';

beforeAll(mockReactFlowDom);
afterEach(cleanup);

describe('P4-B.1 시작 선택지 4개 (말이나 글로 설명해서 만들기 추가)', () => {
  it('4개 선택지 스냅샷 — 기존 3개 유지', () => {
    render(<BuilderPage route="/builder/new" catalog={DEFAULT_CATALOG} />);
    const group = screen.getByRole('group', { name: '시작 방법' });
    const options = within(group)
      .getAllByRole('button')
      .map((b) => b.textContent);
    expect(options).toMatchInlineSnapshot(`
      [
        "빈 캔버스노드를 하나씩 끌어다 놓습니다",
        "플러그인에서 시작플러그인 파이프라인을 펼쳐 고칩니다",
        "기존 에이전트 복제등록된 에이전트를 복사해 고칩니다",
        "말이나 글로 설명해서 만들기AI에게 원하는 에이전트를 설명하면 초안을 만들어 줘요",
      ]
    `);
  });

  it('선택하면 빈 캔버스에서 시작 (서랍은 대화 탭으로 열 표시)', () => {
    const r = startGraph({ kind: 'chat' }, DEFAULT_CATALOG);
    expect(r.graph.nodes).toHaveLength(0);
    expect(r).toMatchObject({ name: 'new-agent', origin: '말이나 글로 설명', mode: 'chat' });
    render(<BuilderPage route="/builder/new" catalog={DEFAULT_CATALOG} />);
    fireEvent.click(screen.getByText('말이나 글로 설명해서 만들기'));
    expect(document.querySelector('.hx-canvas')?.getAttribute('data-node-count')).toBe('0');
    expect(screen.getByText('말이나 글로 설명')).toBeTruthy();
  });
});
