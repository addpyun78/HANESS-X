// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActionCard } from '../src/panels/Approvals/ActionCard.js';
import { ApprovalsArea } from '../src/panels/Approvals/ApprovalsArea.js';
import { toActionCard } from '../src/panels/Approvals/model.js';
import { CSS_FILE, fixtureCard } from './approvals-fixtures.js';

afterEach(cleanup);

describe('H.8 기술 정보는 기본 접힘', () => {
  it('기본 렌더에서 숨김 → "자세히 보기"를 누르면 보임', () => {
    const card = fixtureCard('path-1');
    render(<ActionCard card={toActionCard(card)} onChoose={() => {}} />);
    const el = screen.getByRole('group', { name: '확인이 필요해요 3.2.2' });
    expect(el.textContent).toContain('계획에는 "하네스/모바일" 폴더에 만들기로 했어요.');
    expect(el.textContent).toContain('(확신 정도: 중간)');
    expect(el.textContent).toContain('AI 추천: 같은 걸로 인정');
    // 원문 값 외 기술 정보(신뢰도 숫자·판정 엔진·비교 방법·차이 표시)는 처음에 없다
    expect(screen.queryByTestId('action-card-technical')).toBeNull();
    for (const hidden of ['0.75', 'codex', '- 하네스/모바일', '비교 방법'])
      expect(el.textContent).not.toContain(hidden);
    const more = within(el).getByRole('button', { name: /자세히 보기/ });
    expect(more.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(more);
    const tech = screen.getByTestId('action-card-technical');
    expect(tech.textContent).toContain('0.75');
    expect(tech.textContent).toContain('codex');
    expect(tech.textContent).toContain('- 하네스/모바일\n+ ai/mobile');
  });
});

describe('H.16 키보드 1/2/3, 포커스 자동 이동, 글자 15px 이상', () => {
  it('새 카드가 오면 첫 버튼으로 포커스, 숫자 키로 고른다', () => {
    const onChoose = vi.fn();
    const card = fixtureCard('path-1');
    render(<ApprovalsArea cards={[card]} onChoose={onChoose} variant="panel" />);
    const buttons = screen.getAllByRole('button').filter((b) => b.dataset.choice);
    expect(document.activeElement).toBe(buttons[0]);
    expect(buttons.map((b) => b.getAttribute('aria-keyshortcuts'))).toEqual(['1', '2', '3', '4']);
    act(() => void fireEvent.keyDown(document.activeElement!, { key: '2' }));
    expect(onChoose).toHaveBeenLastCalledWith(card.id, 'redo', false);
    // 체크 상자를 켜고 1
    const box = screen.getByRole('checkbox', { name: '다음부터 같은 경우는 자동으로 처리해 주세요' });
    fireEvent.click(box);
    act(() => void fireEvent.keyDown(box, { key: '1' }));
    expect(onChoose).toHaveBeenLastCalledWith(card.id, 'accept', true);
    act(() => void fireEvent.keyDown(buttons[0]!, { key: '3' }));
    expect(onChoose).toHaveBeenLastCalledWith(card.id, 'stop', true);
    // 없는 번호·수정키는 무시
    act(() => void fireEvent.keyDown(buttons[0]!, { key: '9' }));
    act(() => void fireEvent.keyDown(buttons[0]!, { key: '1', ctrlKey: true }));
    expect(onChoose).toHaveBeenCalledTimes(3);
  });

  it('카드 글자 크기는 모두 15px 이상', () => {
    const css = readFileSync(CSS_FILE, 'utf8');
    const sizes = [
      ...css.matchAll(/\.hx-(?:approvals|action-card|toast|approval-mini)[^{]*\{[^}]*?font-size:\s*(\d+)px/g),
    ].map((m) => Number(m[1]));
    expect(sizes.length).toBeGreaterThanOrEqual(10);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(15);
  });
});
