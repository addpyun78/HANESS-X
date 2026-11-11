// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkPlainKorean } from '../../../packages/plugins-core/approvals/src/plain-korean.js';
import { installApi } from '../src/install/api.js';
import {
  FIRST_RUN_BUTTONS,
  FIRST_RUN_KIND,
  FirstRunCard,
  firstRunsFromEvents,
} from '../src/install/FirstRunCard.js';

afterEach(cleanup);

const request = (id: string) => ({
  id,
  ts: '2026-11-11T00:00:00.000Z',
  sessionId: 'tools',
  type: 'approval_request',
  approvalId: id,
  kind: FIRST_RUN_KIND,
  title: '새 도구를 처음 써요',
  detail: {
    toolId: 'winget:jqlang.jq',
    toolName: 'jq',
    command: 'jq . a.json',
    whatHappened: '방금 설치한 도구 "jq"을(를) 처음 실행하려고 해요.',
    whyAsking: '새 도구는 처음 한 번 사람이 허락해야 실행돼요.',
    timeoutNote: '5분 안에 고르지 않으면 실행하지 않아요.',
  },
  options: ['once', 'always', 'deny'],
});

describe('P2-F.6 보강: 새 도구 첫 실행 확인 카드 (패널)', () => {
  it('이벤트 → 카드, 같은 id의 approval_resolved가 오면 사라짐', () => {
    expect(firstRunsFromEvents([request('a'), request('b')]).map((x) => x.id)).toEqual(['a', 'b']);
    expect(
      firstRunsFromEvents([request('a'), { type: 'approval_resolved', approvalId: 'a', choice: 'deny' }]),
    ).toEqual([]);
    expect(firstRunsFromEvents([{ ...request('c'), kind: 'tool.picker' }])).toEqual([]);
  });

  it('버튼 3개 쉬운 말, [앞으로 허락] → POST /api/install/first-run/:id {choice: always}', async () => {
    for (const b of FIRST_RUN_BUTTONS)
      expect(checkPlainKorean(b.label, { label: true }).ok, b.label).toBe(true);
    const req = vi.fn(async (_path: string, _init?: RequestInit) => ({ id: 'a', choice: 'always' }));
    const api = installApi({ request: req as never });
    const onDone = vi.fn();
    const [data] = firstRunsFromEvents([request('a')]);
    render(<FirstRunCard data={data!} answer={api.firstRunAnswer!} onDone={onDone} />);
    expect(screen.getByText('이번만 허락')).toBeTruthy();
    expect(screen.getByText('허락 안 함')).toBeTruthy();
    expect(screen.getByText(/처음 실행하려고 해요/)).toBeTruthy();
    fireEvent.click(screen.getByText('앞으로 허락'));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('always'));
    expect(req).toHaveBeenCalledWith('/api/install/first-run/a', {
      method: 'POST',
      body: JSON.stringify({ choice: 'always' }),
    });
  });

  it('답 보내기 실패 → 카드 유지 + 다시 누르라는 안내', async () => {
    const answer = vi.fn(async () => {
      throw new Error('404');
    });
    const onDone = vi.fn();
    const [data] = firstRunsFromEvents([request('a')]);
    render(<FirstRunCard data={data!} answer={answer} onDone={onDone} />);
    fireEvent.click(screen.getByText('허락 안 함'));
    await screen.findByText('답을 보내지 못했어요. 다시 눌러 주세요.');
    expect(answer).toHaveBeenCalledWith('a', 'deny');
    expect(onDone).not.toHaveBeenCalled();
  });
});
