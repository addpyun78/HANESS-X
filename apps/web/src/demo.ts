import type { HarnessEvent } from '@harness-x/protocol';
import type { SessionSummary, Workspace } from './shell/types.js';

/**
 * 사람 확인용 데모 데이터: 주소에 ?demo (기본 이벤트) 또는 ?demo=5000 (이벤트 5,000개, 가상 스크롤 확인).
 * 서버 없이 화면을 볼 수 있게 한다.
 */

export const DEMO_WORKSPACE: Workspace = {
  name: 'harness-x',
  path: 'C:\\agentCli\\harness-x',
  branch: 'main',
};

export const DEMO_SESSIONS: SessionSummary[] = [
  {
    id: 's1',
    title: '로그인 폼 만들기',
    status: 'running',
    project: 'harness-x',
    engineId: 'claude-code',
    updatedAt: '2026-11-10T05:00:00Z',
  },
  {
    id: 's2',
    title: '테스트 정리',
    status: 'done',
    project: 'harness-x',
    engineId: 'codex',
    updatedAt: '2026-11-10T03:00:00Z',
  },
  {
    id: 's3',
    title: '블로그 글 목록',
    status: 'blocked',
    project: 'blog',
    engineId: 'claude-code',
    updatedAt: '2026-11-09T12:00:00Z',
  },
];

export function demoEvents(n?: number): HarnessEvent[] {
  const S = 's1';
  const t = (i: number) => new Date(Date.UTC(2026, 10, 10, 5, 0, 0, i)).toISOString();
  const base: HarnessEvent[] = [
    {
      id: 'd1',
      ts: t(1),
      sessionId: S,
      engineId: 'claude-code',
      type: 'assistant_text',
      text: '체크리스트 2.1 "로그인 폼"부터 진행하겠습니다.',
    },
    {
      id: 'd2',
      ts: t(2),
      sessionId: S,
      engineId: 'claude-code',
      itemId: '2.1',
      type: 'tool_call',
      callId: 'c1',
      tool: 'Bash',
      input: { command: 'pnpm test login' },
    },
    {
      id: 'd3',
      ts: t(3),
      sessionId: S,
      engineId: 'claude-code',
      itemId: '2.1',
      type: 'tool_result',
      callId: 'c1',
      ok: true,
      output: 'Tests  4 passed (4)',
    },
    {
      id: 'd4',
      ts: t(4),
      sessionId: S,
      itemId: '2.1',
      type: 'file_change',
      path: 'src/login/LoginForm.tsx',
      change: 'create',
      diff: '+export function LoginForm() {\n+  return <form />;\n+}',
    },
    {
      id: 'd5',
      ts: t(5),
      sessionId: S,
      type: 'checklist_change',
      changedItemId: '2.1',
      from: 'verifying',
      to: 'done',
      version: 4,
    },
    {
      id: 'd6',
      ts: t(6),
      sessionId: S,
      type: 'usage',
      inputTokens: 18200,
      outputTokens: 2400,
      quotaRatio: 0.42,
    },
    {
      id: 'd7',
      ts: t(7),
      sessionId: S,
      type: 'turn_end',
      reason: 'blocked',
      remaining: 3,
      nextItemId: '2.2',
      nextItemTitle: '비밀번호 검증 추가',
    } as HarnessEvent,
  ];
  if (!n || n <= base.length) return base;
  const out = [...base];
  for (let i = base.length; i < n; i++) {
    out.push(
      i % 3 === 0
        ? {
            id: `x${i}`,
            ts: t(i),
            sessionId: S,
            type: 'tool_call',
            callId: `x${i}`,
            tool: 'Read',
            input: { path: `src/f${i}.ts` },
          }
        : {
            id: `x${i}`,
            ts: t(i),
            sessionId: S,
            type: 'assistant_text',
            text: `진행 메시지 ${i}번 — 가상 스크롤 확인용 텍스트입니다.`,
          },
    );
  }
  return out;
}
