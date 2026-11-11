// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../src/api/client.js';
import { BuilderPage } from '../src/builder/BuilderPage.js';
import { RESUME_TEXT, STALE_TEXT } from '../src/builder/draft/DraftCards.js';
import { FILL_GAPS_LABEL, SAVE_INCOMPLETE_LABEL } from '../src/builder/draft/SaveDialog.js';
import { paletteItems } from '../src/composer/SlashPalette.js';
import { checkPlainKorean } from '../../../packages/plugins-core/approvals/src/plain-korean.js';
import { DRAFT_CATALOG, fakeDesignerApi, sampleDraft, startChatAndSend } from './draft-fixtures.js';
import { mockReactFlowDom } from './flow-mock.js';

beforeAll(mockReactFlowDom);
afterEach(cleanup);

const draftResponse = (d = sampleDraft()) => ({
  kind: 'draft' as const,
  draftId: '',
  version: 1,
  draft: d,
  notices: [],
  engineSuggestions: [],
});

describe('P4-F.3 저장 버튼 → 확인 창 (요약 + 이름·명령 수정 + 빈 칸 선택지)', () => {
  it('빈 칸이 있을 때 확인 창 스냅샷, 버튼을 누를 때만 클릭 토큰을 받는다', async () => {
    const api = fakeDesignerApi({ design: [draftResponse()] });
    await startChatAndSend(api);
    expect(api.gestureToken).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    const dlg = screen.getByRole('dialog', { name: '에이전트 저장' });
    const texts = [...dlg.querySelectorAll('h3, li, p, button')].map((x) => x.textContent!.trim());
    expect(texts).toMatchInlineSnapshot(`
      [
        "이 에이전트를 저장할까요?",
        "임장노트 화면 디자인을 살펴보고 고쳐요.",
        "먼저 계획을 세우고 codex가 화면을 고쳐요.",
        "마지막으로 다른 AI가 결과를 한 번 더 검사해요.",
        "빈 칸이 1개 있어요.",
        "빈 칸 채우고 저장하기(권장)",
        "빈 칸 있는 채로 저장 — 실행은 안 됨",
        "닫기",
      ]
    `);
    expect((within(dlg).getByLabelText('저장할 이름') as HTMLInputElement).value).toBe('design-review');
    expect((within(dlg).getByLabelText('저장할 명령') as HTMLInputElement).value).toBe('/design-review');
    for (const t of texts.slice(0, 5)) expect(checkPlainKorean(t).ok, t).toBe(true);
    // [빈 칸 채우고 저장하기] = 저장하지 않고 고치러 돌아감
    fireEvent.click(within(dlg).getByText(FILL_GAPS_LABEL));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.saveAgent).not.toHaveBeenCalled();
    // [빈 칸 있는 채로 저장]
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    fireEvent.change(screen.getByLabelText('저장할 이름'), { target: { value: 'imjang-review' } });
    expect((screen.getByLabelText('저장할 명령') as HTMLInputElement).value).toBe('/imjang-review');
    fireEvent.click(screen.getByText(SAVE_INCOMPLETE_LABEL));
    await vi.waitFor(() => expect(api.saveAgent).toHaveBeenCalledTimes(1));
    expect(api.gestureToken).toHaveBeenCalledWith('save-agent');
    const [body, token] = vi.mocked(api.saveAgent).mock.calls[0]!;
    expect(token).toBe('gesture-1');
    expect(body).toMatchObject({
      draftId: 'draft-1',
      allowIncomplete: true,
      draft: { name: 'imjang-review', command: '/imjang-review' },
    });
    await vi.waitFor(() =>
      expect(screen.getByText(/저장됐어요 · \/imjang-review로 부를 수 있어요/)).toBeTruthy(),
    );
  });

  it('빈 칸이 없으면 [저장] 하나', async () => {
    const api = fakeDesignerApi({ design: [draftResponse(sampleDraft({ gaps: [] }))] });
    await startChatAndSend(api);
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    const dlg = screen.getByRole('dialog');
    expect(within(dlg).queryByText(SAVE_INCOMPLETE_LABEL)).toBeNull();
    fireEvent.click(within(dlg).getByRole('button', { name: '저장' }));
    await vi.waitFor(() => expect(api.saveAgent).toHaveBeenCalled());
    expect(vi.mocked(api.saveAgent).mock.calls[0]![0].allowIncomplete).toBeUndefined();
  });

  it('P4-F.4 이름이 겹치면 서버 제안 이름을 보여 주고 [이 이름 쓰기]', async () => {
    const api = fakeDesignerApi({ design: [draftResponse(sampleDraft({ gaps: [] }))] });
    vi.mocked(api.saveAgent).mockRejectedValueOnce(
      new ApiError(409, {
        error: 'name_taken',
        message: '이미 있는 이름이에요.',
        suggestion: { name: 'design-review-2', command: '/design-review-2' },
      }),
    );
    await startChatAndSend(api);
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '저장' }));
    await vi.waitFor(() => expect(screen.getByText(/"design-review-2"는 어떨까요\?/)).toBeTruthy());
    fireEvent.click(screen.getByText('이 이름 쓰기'));
    expect((screen.getByLabelText('저장할 이름') as HTMLInputElement).value).toBe('design-review-2');
    expect((screen.getByLabelText('저장할 명령') as HTMLInputElement).value).toBe('/design-review-2');
  });
});

describe('P4-F.6 incomplete 에이전트는 / 목록에 회색 + 안내', () => {
  it('팔레트 항목 incomplete 표시', () => {
    const items = paletteItems([
      {
        name: 'design-review',
        command: '/design-review',
        displayName: '화면 디자인 검수',
        source: 'user',
        defaultEngine: 'auto',
        nodeCount: 3,
        status: 'incomplete',
      },
    ]);
    expect(items[0]).toMatchObject({ incomplete: true });
  });
});

describe('P4-F.9 초안 자동 보관: 새로고침 후 "만들던 초안이 있어요. 이어서 할까요?" → 복원', () => {
  it('캔버스 수정이 자동 보관되고, 새로 열면 이어서 하기로 그대로 복원', async () => {
    const api = fakeDesignerApi({ design: [draftResponse()] });
    const first = await startChatAndSend(api);
    // 캔버스 직접 수정 (스킬 칩 빼기) → 자동 보관
    fireEvent.click(screen.getByLabelText('ui-tokens 스킬 빼기'));
    await vi.waitFor(() =>
      expect(api.store.get('draft-1')!.working?.nodes.find((n) => n.id === 'build')!.skills).toEqual([
        'kotlin-compose',
      ]),
    );
    first.unmount(); // 창 닫기·새로고침

    render(<BuilderPage route="/builder/new" catalog={DRAFT_CATALOG} designerApi={api} animate={false} />);
    const prompt = await screen.findByRole('region', { name: '이어서 하기' });
    expect(within(prompt).getByText(RESUME_TEXT)).toBeTruthy();
    expect(checkPlainKorean(RESUME_TEXT).ok).toBe(true);
    fireEvent.click(within(prompt).getByText('이어서 하기'));
    await vi.waitFor(() => expect(document.querySelectorAll('.hx-node')).toHaveLength(3));
    const chips = [...document.querySelectorAll('.hx-node[data-node-id="build"] .hx-skill-chip')].map((c) =>
      c.getAttribute('data-skill'),
    );
    expect(chips).toEqual(['kotlin-compose']);
    expect(screen.getByText('초안 v1 · 아직 저장 안 됨')).toBeTruthy();
    expect(screen.getByText('임장노트 화면 디자인을 검수해 주는 에이전트 만들어 줘')).toBeTruthy(); // 대화도 복원
  });
});

describe('P4-F.10 초안 목록 (이어서 하기·삭제), 30일 지난 초안은 정리 제안만', () => {
  it('목록 테스트', async () => {
    const d = sampleDraft();
    const rec = (id: string, updatedAt: string, name: string) => ({
      id,
      request: name,
      createdAt: updatedAt,
      updatedAt,
      conversation: [],
      versions: [{ v: 1, at: updatedAt, source: 'ai' as const, draft: { ...d, displayName: name } }],
    });
    const api = fakeDesignerApi({
      drafts: [
        rec('old', '2026-09-01T00:00:00.000Z', '오래된 초안'),
        rec('new', '2026-11-10T00:00:00.000Z', '새 초안'),
      ],
    });
    render(<BuilderPage route="/builder/new" catalog={DRAFT_CATALOG} designerApi={api} animate={false} />);
    const list = await screen.findByRole('region', { name: '만들던 초안' });
    const rows = [...list.querySelectorAll('li')].map((li) => li.firstChild!.textContent);
    expect(rows).toEqual(['오래된 초안 · 버전 1개 · 빈 칸 1개 · 오래됨', '새 초안 · 버전 1개 · 빈 칸 1개']);
    expect(within(list).getByRole('note').textContent).toBe(STALE_TEXT);
    expect(checkPlainKorean(STALE_TEXT).ok).toBe(true);
    expect(api.deleteDraft).not.toHaveBeenCalled(); // 자동 삭제 없음
    fireEvent.click(within(list.querySelector('li[data-stale]') as HTMLElement).getByText('삭제'));
    await vi.waitFor(() => expect(api.deleteDraft).toHaveBeenCalledWith('old'));
    await vi.waitFor(() => expect(list.querySelectorAll('li')).toHaveLength(1));
    fireEvent.click(within(list).getByText('이어서 하기'));
    await vi.waitFor(() => expect(document.querySelectorAll('.hx-node')).toHaveLength(3));
    expect(api.getDraft).toHaveBeenCalledWith('new');
  });
});
