// @vitest-environment jsdom
import type { HarnessEvent } from '@harness-x/protocol';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BlockView } from '../src/chat/BlockView.js';
import { eventsToBlocks } from '../src/chat/blocks.js';
import { ApprovalsArea } from '../src/panels/Approvals/ApprovalsArea.js';
import { ApprovalFocusContext, useApprovals } from '../src/panels/Approvals/useApprovals.js';
import { fixtureCard, requestEvent } from './approvals-fixtures.js';

afterEach(cleanup);

function Page({ events }: { events: HarnessEvent[] }) {
  const a = useApprovals({ events });
  return (
    <ApprovalFocusContext.Provider value={{ focus: (id) => a.setFocusId(id) }}>
      <main aria-label="채팅">
        {eventsToBlocks(events).map((b) => (
          <BlockView key={b.id} block={b} />
        ))}
      </main>
      <aside aria-label="우측 패널">
        <ApprovalsArea
          cards={a.pending}
          onChoose={() => {}}
          variant="panel"
          {...(a.focusId ? { focusId: a.focusId } : {})}
          onFocused={() => a.setFocusId(undefined)}
        />
      </aside>
    </ApprovalFocusContext.Provider>
  );
}

describe('H.14 채팅 스트림에 축소 카드, 누르면 패널 카드로', () => {
  it('이동 테스트: 축소 카드 클릭 → 그 카드로 스크롤 + 첫 버튼 포커스', () => {
    const a = fixtureCard('path-1');
    const b = fixtureCard('text-1');
    const scrolled: string[] = [];
    const spy = vi.fn(function (this: HTMLElement) {
      scrolled.push(this.dataset.cardId ?? '');
    });
    HTMLElement.prototype.scrollIntoView = spy;
    render(<Page events={[requestEvent(a), requestEvent(b)] as unknown as HarnessEvent[]} />);

    const chat = screen.getByRole('main', { name: '채팅' });
    const minis = chat.querySelectorAll<HTMLButtonElement>('.hx-approval-mini');
    expect(minis).toHaveLength(2);
    // 채팅에는 축소 카드만 (버튼 선택지는 패널에만)
    expect(chat.querySelectorAll('[data-choice]')).toHaveLength(0);
    expect(minis[1]!.textContent).toContain('확인이 필요해요 — 계획에는 "로그인 성공"');

    fireEvent.click(screen.getByRole('button', { name: '확인이 필요해요 (항목 4.1) — 카드 보기' }));
    expect(scrolled).toEqual(['fx-text-1']);
    const panelCard = document.querySelector('[data-card-id="fx-text-1"]')!;
    expect(panelCard.contains(document.activeElement)).toBe(true);
    expect((document.activeElement as HTMLElement).dataset.choice).toBe('accept');

    fireEvent.click(screen.getByRole('button', { name: '확인이 필요해요 (항목 3.2.2) — 카드 보기' }));
    expect(scrolled).toEqual(['fx-text-1', 'fx-path-1']);
    expect(document.querySelector('[data-card-id="fx-path-1"]')!.contains(document.activeElement)).toBe(true);
  });
});
