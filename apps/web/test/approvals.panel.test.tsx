// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ApprovalsArea } from '../src/panels/Approvals/ApprovalsArea.js';
import { AppShell } from '../src/shell/AppShell.js';
import { fixtureCard } from './approvals-fixtures.js';

afterEach(cleanup);

const shell = (cards = [fixtureCard('path-1'), fixtureCard('text-1')]) =>
  render(
    <AppShell
      topBar={{ runState: 'idle', quotas: [] }}
      sidebar={<nav aria-label="세션 사이드바">사이드</nav>}
      main={<div>채팅</div>}
      panelContent={{ checklist: <section aria-label="체크리스트">체크리스트 트리</section> }}
      panelTop={<ApprovalsArea cards={cards} onChoose={() => {}} />}
    />,
  );

describe('H.11 우측 패널 맨 위 "확인이 필요해요" 영역 (체크리스트 위) + 개수 배지', () => {
  it('스냅샷: 탭·체크리스트보다 위에 고정, 2장이면 배지 2', () => {
    shell();
    const panel = screen.getByLabelText('우측 패널');
    const area = screen.getByRole('region', { name: '확인이 필요해요' });
    expect(panel.firstElementChild).toBe(area);
    const tabs = screen.getByRole('tablist');
    const checklist = screen.getByRole('region', { name: '체크리스트' });
    expect(area.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(area.compareDocumentPosition(checklist) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByLabelText('카드 2장').textContent).toBe('2');
    expect(area.dataset.variant).toBe('panel');
    expect(panel).toMatchSnapshot();
  });

  it('1장이면 배지 없음, 0장이면 영역 자체가 없다', () => {
    shell([fixtureCard('path-1')]);
    expect(screen.getByRole('region', { name: '확인이 필요해요' })).toBeTruthy();
    expect(screen.queryByLabelText(/카드 \d+장/)).toBeNull();
    cleanup();
    shell([]);
    expect(screen.queryByRole('region', { name: '확인이 필요해요' })).toBeNull();
    expect(screen.getByLabelText('우측 패널').firstElementChild?.getAttribute('role')).toBe('tablist');
  });
});
