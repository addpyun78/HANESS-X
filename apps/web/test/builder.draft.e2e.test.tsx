// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { paletteItems } from '../src/composer/SlashPalette.js';
import {
  criticToClaude,
  fakeDesignerApi,
  sampleDraft,
  sendChat,
  startChatAndSend,
} from './draft-fixtures.js';
import { blockTransfer, mockReactFlowDom } from './flow-mock.js';

beforeAll(mockReactFlowDom);
afterEach(cleanup);

const node = (id: string) => document.querySelector(`.hx-node[data-node-id="${id}"]`) as HTMLElement;
const engineOf = (id: string) => node(id).querySelector('.hx-engine-chip')!.getAttribute('data-engine');

/**
 * P4-G.5 수정 E2E (화면 쪽): 초안 → "검사는 claude로" → 미리보기 → 적용 → 캔버스 직접 수정 → 저장 → / 목록
 * 서버 쪽 같은 흐름(실제 API·레지스트리·디스패처 실행)은 agent-builder/test/designer.e2e.test.ts
 */
describe('P4-G.5 수정 E2E (화면)', () => {
  it('초안 → 말로 고치기 → 미리보기 → 적용 → 캔버스 수정 → 저장 → / 목록에 실행 가능한 항목', async () => {
    const api = fakeDesignerApi({
      design: [
        { kind: 'draft', draftId: '', version: 1, draft: sampleDraft(), notices: [], engineSuggestions: [] },
      ],
      edit: (d) => criticToClaude(d),
    });
    await startChatAndSend(api);
    // 말로 고치기 → 미리보기
    await sendChat('검사는 claude로');
    const box = screen.getByRole('region', { name: '바뀐 점' });
    expect(node('critic').getAttribute('data-changed')).toBe('true');
    // 적용
    fireEvent.click(within(box).getByText('적용'));
    expect(engineOf('critic')).toBe('claude-code');
    // 캔버스 직접 수정: 스킬 장착 + 빈 칸 빼기
    fireEvent.drop(node('build'), { dataTransfer: blockTransfer('skill', 'ui-audit') });
    fireEvent.click(screen.getByText('이 칸 빼기'));
    await vi.waitFor(() => expect(screen.queryByRole('list', { name: '빈 칸' })).toBeNull());
    // 저장 (빈 칸이 없으니 [저장] 하나)
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '저장' }));
    await vi.waitFor(() => expect(api.saveAgent).toHaveBeenCalledTimes(1));
    const [body, token] = vi.mocked(api.saveAgent).mock.calls[0]!;
    expect(token).toBe('gesture-1');
    expect(body.draft.gaps).toEqual([]);
    expect(body.draft.nodes.find((n) => n.id === 'critic')!.engine).toBe('claude-code');
    expect(body.draft.nodes.find((n) => n.id === 'build')!.skills).toEqual([
      'kotlin-compose',
      'ui-tokens',
      'ui-audit',
    ]);
    await vi.waitFor(() =>
      expect(screen.getByText(/저장됐어요 · \/design-review로 부를 수 있어요/)).toBeTruthy(),
    );
    // / 목록: 저장된 에이전트가 회색이 아닌(실행 가능한) 항목으로
    const saved = await vi.mocked(api.saveAgent).mock.results[0]!.value;
    const items = paletteItems([
      {
        name: saved.name,
        command: saved.command,
        displayName: '화면 디자인 검수',
        source: 'user',
        defaultEngine: 'auto',
        nodeCount: 3,
        ...(saved.status === 'incomplete' ? { status: 'incomplete' as const } : {}),
      },
    ]);
    expect(items[0]).toMatchObject({ command: '/design-review', group: 'agent' });
    expect(items[0]!.incomplete).toBeUndefined();
  });
});
