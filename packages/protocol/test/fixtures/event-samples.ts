const base = { id: 'e1', ts: '2026-11-10T09:00:00.000Z', sessionId: 's1', engineId: 'claude-code' };

/** 타입별 정상 샘플 9개 */
export const validSamples = [
  { ...base, type: 'assistant_text', text: '안녕하세요', partial: false },
  { ...base, type: 'tool_call', callId: 'c1', tool: 'Write', input: { path: 'a.ts' } },
  { ...base, type: 'tool_result', callId: 'c1', ok: true, output: 'done' },
  { ...base, type: 'file_change', path: 'harness/mobile/a.kt', change: 'create' },
  { ...base, type: 'usage', inputTokens: 120, outputTokens: 30, costUsd: 0.001 },
  { ...base, type: 'error', code: 'quota_exceeded', message: '한도 초과', retryable: true },
  { ...base, type: 'turn_end', reason: 'completed' },
  {
    ...base,
    type: 'approval_request',
    approvalId: 'a1',
    kind: 'path_equivalence',
    title: '경로 동치 확인',
    options: ['equivalent', 'move', 'fail'],
  },
  {
    ...base,
    itemId: 'i1',
    type: 'checklist_change',
    changedItemId: 'i1',
    from: 'todo',
    to: 'doing',
    version: 2,
  },
] as const;

/** 타입별 잘못된 샘플 9개 (각 1개 필드 위반) */
export const invalidSamples = [
  { ...base, type: 'assistant_text', text: 42 },
  { ...base, type: 'tool_call', callId: 'c1' }, // tool 누락
  { ...base, type: 'tool_result', callId: 'c1', ok: 'yes', output: null },
  { ...base, type: 'file_change', path: 'a', change: 'touch' },
  { ...base, type: 'usage', inputTokens: -1, outputTokens: 0 },
  { ...base, type: 'error', message: 'no code' },
  { ...base, type: 'turn_end', reason: 'bored' },
  { ...base, type: 'approval_request', approvalId: 'a1', kind: 'k', title: 't', options: [] },
  {
    ...base,
    ts: 'yesterday',
    type: 'checklist_change',
    changedItemId: 'i1',
    from: null,
    to: 'doing',
    version: 1,
  },
] as const;
