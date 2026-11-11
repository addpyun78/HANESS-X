import type { AgentDraftInput } from '@harness-x/protocol';
import { emptyWorkspaceContext, type EngineAsset, type Inventory } from '../src/inventory/schema.js';

/** 설계 테스트용 인벤토리: 스킬 4 · 엔진 4(gemini는 로그인 필요) · 도구 1 · 에이전트 1 */
export function designerInventory(over: Partial<Inventory> = {}): Inventory {
  const engine = (id: string, binary: string, health: EngineAsset['health'] = 'ready'): EngineAsset => ({
    id,
    binary,
    installed: true,
    version: '1.0.0',
    location: 'linux',
    host: 'other',
    login: health === 'needs-login' ? 'loggedOut' : 'loggedIn',
    mode: 'subscription',
    quota: { level: 'ok' },
    health,
  });
  const skill = (id: string, description: string) => ({
    id,
    name: id,
    description,
    pluginId: 'design-skills',
    tags: [],
    health: 'ready' as const,
  });
  return {
    snapshotId: 'snap-1',
    createdAt: '2026-11-11T00:00:00.000Z',
    plugins: [],
    skills: [
      skill('plan-writer', '작업 계획 쓰기'),
      skill('kotlin-compose', 'Kotlin Compose 화면 고치기'),
      skill('ui-tokens', '디자인 토큰 맞추기'),
      skill('ui-audit', '화면 디자인 검수'),
    ],
    engines: [
      engine('claude-code', 'claude'),
      engine('codex', 'codex'),
      engine('antigravity', 'agy'),
      engine('gemini', 'gemini', 'needs-login'),
    ],
    tools: [
      {
        id: 'screenshot',
        name: 'screenshot',
        kind: 'cli',
        pricing: 'free',
        purpose: '화면 찍기',
        capabilities: ['screenshot'],
        source: 'plugin',
        health: 'ready',
      },
    ],
    mcpServers: [],
    agents: [
      {
        name: 'design-qa',
        command: '/design-qa',
        displayName: '디자인 검수',
        source: 'plugin',
        defaultEngine: 'auto',
        nodes: [],
        health: 'ready',
      },
    ],
    pipelines: [],
    comparators: [],
    workspace: emptyWorkspaceContext('imjang-note'),
    ...over,
  };
}

/** 화면 예시(컨셉 E) 초안: 계획(claude) → 고치기(codex) → 검사(agy) + 빈 칸 1 */
export function sampleDraft(over: Partial<AgentDraftInput> = {}): AgentDraftInput {
  return {
    name: 'design-review',
    displayName: '화면 디자인 검수',
    command: '/design-review',
    summary: [
      '임장노트 화면 디자인을 살펴보고 고쳐요.',
      '먼저 계획을 세우고 codex가 화면을 고쳐요.',
      '마지막으로 다른 AI가 결과를 한 번 더 검사해요.',
    ].join('\n'),
    nodes: [
      {
        id: 'plan',
        kind: 'role',
        role: '계획 담당',
        duty: 'plan',
        engine: 'claude-code',
        skills: ['plan-writer'],
        permission: 'read-only',
        reason: '계획은 글을 잘 정리하는 AI에게 맡겼어요.',
      },
      {
        id: 'build',
        kind: 'role',
        role: '고치기 담당',
        duty: 'write',
        engine: 'codex',
        skills: ['kotlin-compose', 'ui-tokens'],
        permission: 'workspace-write',
        reason: '말씀하신 대로 고치는 일은 codex에게 맡겼어요.',
      },
      {
        id: 'critic',
        kind: 'role',
        role: '검사 담당',
        duty: 'check',
        engine: 'antigravity',
        skills: ['ui-audit'],
        permission: 'read-only',
        reason: '고친 AI와 다른 AI가 검사해야 더 객관적이에요.',
      },
    ],
    edges: [
      { from: 'plan', to: 'build' },
      { from: 'build', to: 'critic' },
    ],
    gaps: [{ id: 'gap-1', need: '화면 스크린샷 두 장을 비교하는 기능', nodeId: 'critic', kind: 'skill' }],
    estimatedCostHint: '구독 범위 안에서 한 번에 10분 정도 걸려요.',
    ...over,
  };
}

/** 설계 엔진 리플레이: 미리 정한 응답을 차례로 돌려주고 받은 질문을 모은다 */
export function replayAsk(answers: readonly (string | object | undefined)[]) {
  const prompts: { system: string; user: string }[] = [];
  let i = 0;
  const ask = (p: { system: string; user: string }) => {
    prompts.push(p);
    const a = answers[Math.min(i++, answers.length - 1)];
    return Promise.resolve(a === undefined ? undefined : typeof a === 'string' ? a : JSON.stringify(a));
  };
  return { ask, prompts, calls: () => i };
}
