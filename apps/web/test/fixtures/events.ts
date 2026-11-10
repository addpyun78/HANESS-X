import type { HarnessEvent } from '@harness-x/protocol';

const ts = (n: number) => `2026-11-10T00:00:${String(n).padStart(2, '0')}.000Z`;
const S = 's-chat';

/** HarnessEvent 9종을 하나씩 (+ 스트리밍 조각, tool_call과 짝인 tool_result) */
export const NINE_EVENTS: HarnessEvent[] = [
  {
    id: 'e1',
    ts: ts(1),
    sessionId: S,
    engineId: 'claude-code',
    type: 'assistant_text',
    text: '파일을 ',
    partial: true,
  },
  {
    id: 'e2',
    ts: ts(2),
    sessionId: S,
    engineId: 'claude-code',
    type: 'assistant_text',
    text: '확인하겠습니다.',
    partial: true,
  },
  {
    id: 'e3',
    ts: ts(3),
    sessionId: S,
    engineId: 'claude-code',
    itemId: '2.1',
    type: 'tool_call',
    callId: 'c1',
    tool: 'Bash',
    input: { command: 'pnpm test' },
  },
  {
    id: 'e4',
    ts: ts(4),
    sessionId: S,
    engineId: 'claude-code',
    itemId: '2.1',
    type: 'tool_result',
    callId: 'c1',
    ok: true,
    output: 'Tests 12 passed',
  },
  {
    id: 'e5',
    ts: ts(5),
    sessionId: S,
    itemId: '2.1',
    type: 'file_change',
    path: 'src/app.ts',
    change: 'modify',
    diff: '@@ -1 +1 @@\n-old\n+new',
  },
  {
    id: 'e6',
    ts: ts(6),
    sessionId: S,
    type: 'usage',
    inputTokens: 1200,
    outputTokens: 340,
    quotaRatio: 0.25,
  },
  {
    id: 'e7',
    ts: ts(7),
    sessionId: S,
    type: 'error',
    code: 'E_TIMEOUT',
    message: '명령 시간 초과',
    retryable: true,
  },
  {
    id: 'e8',
    ts: ts(8),
    sessionId: S,
    type: 'approval_request',
    approvalId: 'a1',
    kind: 'path_equivalence',
    title: 'ai/mobile을 하네스/모바일과 같은 경로로 인정할까요?',
    options: ['동치 인정', '이동', '실패'],
  },
  {
    id: 'e9',
    ts: ts(9),
    sessionId: S,
    type: 'checklist_change',
    changedItemId: '2.1',
    from: 'doing',
    to: 'done',
    version: 3,
  },
  { id: 'e10', ts: ts(10), sessionId: S, type: 'turn_end', reason: 'completed' },
];

/** 종료 차단 이벤트 (turn_end reason=blocked + 확장 필드) */
export const STOP_BLOCK_EVENT = {
  id: 'sb1',
  ts: ts(11),
  sessionId: S,
  type: 'turn_end',
  reason: 'blocked',
  remaining: 3,
  nextItemId: '2.2',
  nextItemTitle: '로그인 폼 검증 추가',
} as HarnessEvent;

/** n개의 다양한 이벤트 */
export function manyEvents(n: number): HarnessEvent[] {
  const out: HarnessEvent[] = [];
  for (let i = 0; i < n; i++) {
    const id = `m${i}`;
    const t = new Date(Date.UTC(2026, 10, 10, 0, 0, 0, i)).toISOString();
    switch (i % 5) {
      case 0:
        out.push({ id, ts: t, sessionId: S, type: 'assistant_text', text: `메시지 ${i}` });
        break;
      case 1:
        out.push({
          id,
          ts: t,
          sessionId: S,
          type: 'tool_call',
          callId: `c${i}`,
          tool: 'Read',
          input: { path: `f${i}.ts` },
        });
        break;
      case 2:
        out.push({
          id,
          ts: t,
          sessionId: S,
          type: 'tool_result',
          callId: `c${i - 1}`,
          ok: true,
          output: 'ok',
        });
        break;
      case 3:
        out.push({ id, ts: t, sessionId: S, type: 'file_change', path: `f${i}.ts`, change: 'modify' });
        break;
      default:
        out.push({ id, ts: t, sessionId: S, type: 'usage', inputTokens: i, outputTokens: i });
    }
  }
  return out;
}
