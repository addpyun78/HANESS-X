// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { HarnessEvent } from '@harness-x/protocol';
import { eventsToBlocks, visibleBlocks } from '../src/chat/blocks.js';
import { BlockView } from '../src/chat/BlockView.js';
import { checkPlainKorean } from './plain-check.js';

afterEach(cleanup);

const ev = (id: string, type: string, body: Record<string, unknown> = {}) =>
  ({ id, ts: `2026-11-12T0${id}:00:00.000Z`, sessionId: 's1', type, ...body }) as unknown as HarnessEvent;

const EVENTS: HarnessEvent[] = [
  ev('1', 'assistant_text', { text: '헤더를 고치는 중이에요.', partial: false }),
  ev('2', 'session_paused', {
    kind: 'pause',
    paused: { reason: 'user', at: '2026-11-12T02:00:00.000Z', by: 'user' },
  }),
  ev('3', 'session_resumed', { mode: 'summary', from: { reason: 'user' } }),
  ev('4', 'assistant_text', { text: '이어서 끝냈어요.', partial: false }),
];

describe('2B.12 세션 타임라인 "멈춤 → 이어감"', () => {
  it('기록 → 표시 줄 블록 (모든 보기 모드에서 보임)', () => {
    const blocks = eventsToBlocks(EVENTS);
    expect(blocks.map((b) => b.kind)).toEqual(['text', 'pause_mark', 'pause_mark', 'text']);
    expect(blocks.filter((b) => b.kind === 'pause_mark').map((b) => (b as { text: string }).text)).toEqual([
      '⏸ 멈춤 (사용자가 멈춤)',
      '▶ 이어감 (지금까지 한 일 요약으로)',
    ]);
    for (const mode of ['verbose', 'normal', 'summary'] as const)
      expect(visibleBlocks(blocks, mode).filter((b) => b.kind === 'pause_mark')).toHaveLength(2);
    const engine = eventsToBlocks([ev('5', 'session_resumed', { mode: 'engine' })]);
    expect((engine[0] as { text: string }).text).toBe('▶ 이어감 (하던 대화 그대로)');
  });

  it('채팅 흐름 블록으로 순서대로 표시 (스냅샷)', () => {
    // 채팅 흐름(ChatStream)이 그리는 블록 하나하나 = BlockView
    render(
      <div>
        {eventsToBlocks(EVENTS).map((b) => (
          <BlockView key={b.id} block={b} />
        ))}
      </div>,
    );
    const marks = screen.getAllByRole('separator');
    expect(marks.map((m) => m.getAttribute('aria-label'))).toEqual([
      '⏸ 멈춤 (사용자가 멈춤)',
      '▶ 이어감 (지금까지 한 일 요약으로)',
    ]);
    expect(marks.map((m) => m.outerHTML).join('\n')).toMatchInlineSnapshot(`
      "<div class="hx-pause-mark hx-pause-mark--paused" role="separator" aria-label="⏸ 멈춤 (사용자가 멈춤)"><span>⏸ 멈춤 (사용자가 멈춤)</span><time datetime="2026-11-12T02:00:00.000Z"></time></div>
      <div class="hx-pause-mark hx-pause-mark--resumed" role="separator" aria-label="▶ 이어감 (지금까지 한 일 요약으로)"><span>▶ 이어감 (지금까지 한 일 요약으로)</span><time datetime="2026-11-12T03:00:00.000Z"></time></div>"
    `);
    for (const m of marks)
      expect(checkPlainKorean(m.textContent!.slice(2), { label: true }).violations).toEqual([]);
  });
});
