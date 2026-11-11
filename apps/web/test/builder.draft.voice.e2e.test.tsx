// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { BuilderPage } from '../src/builder/BuilderPage.js';
import { DRAFT_CATALOG, fakeDesignerApi, sampleDraft } from './draft-fixtures.js';
import { mockReactFlowDom } from './flow-mock.js';
import { fakeStt } from './stt-fake.js';

beforeAll(mockReactFlowDom);
afterEach(cleanup);

const input = () => screen.getByLabelText('설명 입력') as HTMLTextAreaElement;
const flush = () => act(async () => {});

describe('P4-G.4 음성 E2E (모킹 STT): 말 → 입력창 채움 → 사용자 수정 → 전송 → 초안 생성', () => {
  it('자동 전송 없이, 고친 글로 설계 요청 → 캔버스에 초안', async () => {
    const stt = fakeStt();
    const api = fakeDesignerApi({
      design: [
        { kind: 'draft', draftId: '', version: 1, draft: sampleDraft(), notices: [], engineSuggestions: [] },
      ],
    });
    render(
      <BuilderPage
        route="/builder/new"
        catalog={DRAFT_CATALOG}
        designerApi={api}
        animate={false}
        loadStt={() => Promise.resolve(stt)}
      />,
    );
    fireEvent.click(screen.getByText('말이나 글로 설명해서 만들기'));
    const mic = await screen.findByRole('button', { name: '말로 입력' });
    // 1) 말하기
    fireEvent.click(mic);
    await flush();
    act(() => stt.say('임장노트 화면 디자인을 검수해 주는 에이전트 만들어 줘'));
    fireEvent.click(screen.getByRole('button', { name: '녹음 끝내기' }));
    await flush();
    // 2) 입력창에만 채워짐 (설계 요청 0회)
    expect(input().value).toBe('임장노트 화면 디자인을 검수해 주는 에이전트 만들어 줘');
    expect(api.design).not.toHaveBeenCalled();
    // 3) 사용자가 고친다
    fireEvent.change(input(), {
      target: { value: '임장노트 화면 디자인 검수 에이전트 만들어 줘. 고치는 건 codex로.' },
    });
    expect(api.design).not.toHaveBeenCalled();
    // 4) 전송
    fireEvent.keyDown(input(), { key: 'Enter' });
    await vi.waitFor(() => expect(api.design).toHaveBeenCalledTimes(1));
    expect(api.designCalls[0]!.request).toBe(
      '임장노트 화면 디자인 검수 에이전트 만들어 줘. 고치는 건 codex로.',
    );
    // 5) 초안 생성: 캔버스 노드 3개 + 빈 칸 + 요약 카드
    await vi.waitFor(() => expect(document.querySelectorAll('.hx-node[data-draft]')).toHaveLength(3));
    expect(screen.getByText('초안 v1 · 아직 저장 안 됨')).toBeTruthy();
    expect(screen.getByRole('list', { name: '빈 칸' })).toBeTruthy();
    const chat = screen.getByRole('list', { name: '대화' });
    expect(
      within(chat).getByText('임장노트 화면 디자인 검수 에이전트 만들어 줘. 고치는 건 codex로.'),
    ).toBeTruthy();
    expect(within(chat).getByRole('region', { name: '초안 요약' })).toBeTruthy();
  });
});
