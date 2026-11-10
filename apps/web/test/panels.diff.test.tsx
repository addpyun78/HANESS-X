// @vitest-environment jsdom
import type { HarnessEvent } from '@harness-x/protocol';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BlockView } from '../src/chat/BlockView.js';
import { eventsToBlocks } from '../src/chat/blocks.js';
import { diffSides, languageOf } from '../src/panels/diff.js';
import { PanelActionsContext } from '../src/panels/panel-actions.js';
import { usePanels } from '../src/panels/usePanels.js';
import { PANEL_TABS } from '../src/shell/layout-store.js';
import { RightPanel } from '../src/shell/RightPanel.js';

// Monaco는 jsdom에서 돌지 않으므로 받은 값만 그리는 가짜로 바꾼다
vi.mock('../src/panels/MonacoDiff.js', () => ({
  MonacoDiff: (p: { original: string; modified: string; language: string }) => (
    <div data-testid="monaco-diff" data-language={p.language}>
      <pre data-side="original">{p.original}</pre>
      <pre data-side="modified">{p.modified}</pre>
    </div>
  ),
}));

afterEach(cleanup);

const DIFF = [
  'diff --git a/src/a.ts b/src/a.ts',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,3 +1,3 @@',
  ' const x = 1;',
  '-const y = 2;',
  '+const y = 3;',
  ' export { x, y };',
  '',
].join('\n');

const FILE_EVENT: HarnessEvent = {
  id: 'f1',
  ts: '2026-11-10T00:00:01.000Z',
  sessionId: 's',
  type: 'file_change',
  path: 'src/a.ts',
  change: 'modify',
  diff: DIFF,
  itemId: '2.1',
};

function Harness() {
  const panels = usePanels({ events: [] });
  const block = eventsToBlocks([FILE_EVENT])[0]!;
  return (
    <PanelActionsContext.Provider value={panels.actions}>
      <BlockView block={block} />
      <RightPanel
        order={PANEL_TABS.map((t) => t.id)}
        onOrderChange={() => {}}
        content={panels.content}
        active={panels.active}
        onActiveChange={panels.setActive}
      />
    </PanelActionsContext.Provider>
  );
}

describe('37.1 Diff 패널', () => {
  it('unified diff → 원본/수정본 복원, 확장자 → 언어', () => {
    expect(diffSides(DIFF)).toEqual({
      original: 'const x = 1;\nconst y = 2;\nexport { x, y };',
      modified: 'const x = 1;\nconst y = 3;\nexport { x, y };',
    });
    expect(diffSides('hello\nworld', 'create')).toEqual({ original: '', modified: 'hello\nworld' });
    expect(diffSides('@@ -1 +1 @@\n-a\n+b\n@@ -9 +9 @@\n c\n')).toEqual({
      original: 'a\n⋯\nc',
      modified: 'b\n⋯\nc',
    });
    expect(languageOf('src/App.tsx')).toBe('typescript');
    expect(languageOf('README')).toBe('plaintext');
  });

  it('파일 변경 카드의 Diff 버튼 → 우측 패널 Diff 탭이 열리고 Monaco diff에 양쪽 내용', () => {
    render(<Harness />);
    expect(screen.getByRole('tab', { name: '체크리스트' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Diff 열기: src/a.ts' }));
    expect(screen.getByRole('tab', { name: 'Diff' }).getAttribute('aria-selected')).toBe('true');
    const panel = screen.getByRole('region', { name: 'Diff: src/a.ts' });
    expect(panel.textContent).toContain('수정');
    const editor = screen.getByTestId('monaco-diff');
    expect(editor.getAttribute('data-language')).toBe('typescript');
    expect(editor.querySelector('[data-side="original"]')!.textContent).toContain('const y = 2;');
    expect(editor.querySelector('[data-side="modified"]')!.textContent).toContain('const y = 3;');
  });

  it('패널 액션이 없으면(단독 렌더) Diff 버튼 없음, diff 없는 변경은 안내', () => {
    render(<BlockView block={eventsToBlocks([FILE_EVENT])[0]!} />);
    expect(screen.queryByRole('button', { name: /Diff 열기/ })).toBeNull();
    cleanup();
    function NoDiff() {
      const panels = usePanels({ events: [] });
      return (
        <PanelActionsContext.Provider value={panels.actions}>
          <BlockView block={eventsToBlocks([{ ...FILE_EVENT, diff: undefined } as HarnessEvent])[0]!} />
          <RightPanel
            order={['diff']}
            onOrderChange={() => {}}
            content={panels.content}
            active={panels.active}
            onActiveChange={panels.setActive}
          />
        </PanelActionsContext.Provider>
      );
    }
    render(<NoDiff />);
    fireEvent.click(screen.getByRole('button', { name: 'Diff 열기: src/a.ts' }));
    expect(screen.getByText('이 변경에는 diff 내용이 없습니다')).toBeTruthy();
  });
});
