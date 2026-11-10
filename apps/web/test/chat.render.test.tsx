// @vitest-environment jsdom
import { HARNESS_EVENT_TYPES } from '@harness-x/protocol';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { BlockView } from '../src/chat/BlockView.js';
import { eventsToBlocks } from '../src/chat/blocks.js';
import { NINE_EVENTS } from './fixtures/events.js';

afterEach(cleanup);

describe('HarnessEvent → 메시지 블록 렌더러', () => {
  it('픽스처가 이벤트 9종을 모두 포함', () => {
    expect(new Set(NINE_EVENTS.map((e) => e.type))).toEqual(new Set(HARNESS_EVENT_TYPES));
  });

  it('partial 텍스트 병합, tool_call·tool_result 짝짓기', () => {
    const blocks = eventsToBlocks(NINE_EVENTS);
    expect(blocks.map((b) => b.kind)).toEqual([
      'text',
      'tool',
      'file',
      'usage',
      'error',
      'approval',
      'checklist',
      'turn_end',
    ]);
    expect(blocks[0]).toMatchObject({ text: '파일을 확인하겠습니다.', streaming: true });
    expect(blocks[1]).toMatchObject({ tool: 'Bash', result: { ok: true, output: 'Tests 12 passed' } });
    // 최종 텍스트가 오면 스트리밍 종료
    const fin = eventsToBlocks([
      ...NINE_EVENTS.slice(0, 2),
      {
        id: 'f',
        ts: NINE_EVENTS[1]!.ts,
        sessionId: 's-chat',
        engineId: 'claude-code',
        type: 'assistant_text',
        text: '파일을 확인했습니다.',
        partial: false,
      },
    ]);
    expect(fin).toHaveLength(1);
    expect(fin[0]).toMatchObject({ text: '파일을 확인했습니다.', streaming: false });
    // 짝 없는 결과는 단독 블록
    expect(eventsToBlocks([NINE_EVENTS[3]!])[0]?.kind).toBe('tool_result');
  });

  it('이벤트 9종 스냅샷 (텍스트·도구 호출·도구 결과·파일 변경·사용량·오류·턴 종료·승인 요청·체크리스트)', () => {
    const singles = NINE_EVENTS.filter((e) => e.id !== 'e2'); // 이벤트 하나 = 블록 하나로 보이게
    const html: Record<string, string> = {};
    for (const e of singles) {
      for (const b of eventsToBlocks([e])) {
        const { container } = render(<BlockView block={b} />);
        html[e.type] = container.innerHTML;
        cleanup();
      }
    }
    expect(Object.keys(html).sort()).toEqual([...HARNESS_EVENT_TYPES].sort());
    for (const t of HARNESS_EVENT_TYPES) expect(html[t]).toMatchSnapshot(t);
  });
});
