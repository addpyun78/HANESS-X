// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ResolveFailureCard } from '../src/install/InstallPlanCard.js';
import { RESOLVE_FAIL_TITLE, cardTexts, failureReason, resolveFailureCard } from '../src/install/model.js';
import { checkPlainKorean } from './plain-check.js';

afterEach(cleanup);

describe('P2-C.6 해석 실패: "이 주소에서 설치 방법을 찾지 못했어요" + 이유(쉬운 말) + [주소 열기]', () => {
  it('실패 카드 스냅샷 + 주소 열기는 누를 때만', () => {
    const result = {
      input: 'https://example.com/some/page',
      classification: { type: 'unknown', url: 'https://example.com/some/page' },
      candidates: [],
      failure: '이 주소에서 설치 방법을 찾지 못했어요.',
    };
    const openUrl = vi.fn();
    const onClose = vi.fn();
    const { container } = render(<ResolveFailureCard result={result} openUrl={openUrl} onClose={onClose} />);
    const el = screen.getByRole('group', { name: RESOLVE_FAIL_TITLE });
    expect(el.textContent).toContain(RESOLVE_FAIL_TITLE);
    // 이유: 서버 문구가 제목과 같으면 주소 모양에 맞는 쉬운 말 이유로 바꾼다
    expect(el.textContent).toContain('하네스가 아는 설치 주소 모양이 아니에요.');
    expect(container.innerHTML).toMatchSnapshot();
    expect(openUrl).not.toHaveBeenCalled();
    fireEvent.click(within(el).getByRole('button', { name: /주소 열기/ }));
    expect(openUrl).toHaveBeenCalledExactlyOnceWith('https://example.com/some/page');
    fireEvent.click(within(el).getByRole('button', { name: /닫기/ }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('서버의 쉬운 말 이유는 그대로, 글은 모두 쉬운 말 검사 통과', () => {
    const cases = [
      {
        input: 'https://github.com/a/b',
        classification: { type: 'github-repo', url: 'https://github.com/a/b' },
        candidates: [],
        failure: '저장소를 살펴볼 수 없어요(인터넷 조회 꺼짐).',
      },
      {
        input: 'https://github.com/a/empty',
        classification: { type: 'github-repo', url: 'https://github.com/a/empty' },
        candidates: [],
        failure: '이 주소에서 설치 방법을 찾지 못했어요.',
      },
      { input: '아무말', classification: { type: 'unknown' }, candidates: [] },
    ];
    expect(failureReason(cases[0]!)).toBe('저장소를 살펴볼 수 없어요. (인터넷 조회 꺼짐)');
    expect(failureReason(cases[1]!)).toBe('저장소 안에서 설치할 수 있는 파일을 찾지 못했어요.');
    for (const r of cases) {
      const card = resolveFailureCard(r);
      const t = cardTexts(card);
      for (const s of t.sentences) expect(checkPlainKorean(s).violations, s).toEqual([]);
      for (const l of t.labels) expect(checkPlainKorean(l, { label: true }).violations, l).toEqual([]);
    }
    // 열 수 없는 입력(주소 아님)에는 [주소 열기]가 없다
    expect(resolveFailureCard(cases[2]!).buttons.map((b) => b.id)).toEqual(['close']);
  });
});
