import { describe, expect, it } from 'vitest';
import { bm25Scores, DEFAULT_PICK_LIMIT, pickRelevant } from '../src/inventory/relevance.js';
import { emptyWorkspaceContext, type Inventory } from '../src/inventory/schema.js';

const FILLER = [
  '엑셀 표 합치기',
  '메일 요약',
  '일정 정리',
  '번역 도우미',
  '회계 장부',
  '음악 재생 목록',
  '날씨 알림',
  '주식 시세',
];

/** 자산 200개: 스킬 120 + 도구 50 + 에이전트 30, 그중 관련 있는 것 몇 개 */
function bigInventory(): Inventory {
  const skills: Inventory['skills'] = Array.from({ length: 120 }, (_, i) => ({
    id: `skill-${i}`,
    name: `skill-${i}`,
    description: `${FILLER[i % FILLER.length]} 스킬 ${i}`,
    tags: [],
    health: 'ready' as const,
  }));
  skills[7] = {
    id: 'kotlin-compose',
    name: 'kotlin-compose',
    description: 'Kotlin Compose 화면 구현',
    tags: ['kotlin', 'compose'],
    health: 'ready',
  };
  skills[50] = {
    id: 'ui-audit',
    name: 'ui-audit',
    description: '화면 디자인 검수 접근성 점검',
    tags: ['디자인', '검수'],
    health: 'ready',
  };
  const tools: Inventory['tools'] = Array.from({ length: 50 }, (_, i) => ({
    id: `tool-${i}`,
    name: `tool-${i}`,
    kind: 'cli',
    pricing: 'unknown' as const,
    purpose: `${FILLER[(i + 3) % FILLER.length]} 도구`,
    capabilities: [],
    source: 'registry' as const,
    health: 'ready' as const,
  }));
  tools[33] = {
    ...tools[33]!,
    id: 'screenshot-diff',
    name: 'screenshot-diff',
    purpose: '화면 스크린샷 비교',
    capabilities: ['screenshot'],
  };
  const agents: Inventory['agents'] = Array.from({ length: 30 }, (_, i) => ({
    name: `agent-${i}`,
    command: `/agent-${i}`,
    displayName: `${FILLER[(i + 5) % FILLER.length]} 에이전트`,
    source: 'user' as const,
    defaultEngine: 'auto',
    nodes: [],
    health: 'ready' as const,
  }));
  agents[12] = { ...agents[12]!, name: 'design-qa', displayName: '디자인 QA 검수' };
  return {
    snapshotId: 's',
    createdAt: '2026-11-11T00:00:00.000Z',
    plugins: [],
    skills,
    engines: ['claude-code', 'codex', 'antigravity', 'gemini'].map((id) => ({
      id,
      binary: id,
      installed: true,
      version: '1.0.0',
      location: 'linux',
      host: 'other' as const,
      login: 'unknown' as const,
      mode: 'unknown' as const,
      quota: { level: 'unknown' as const },
      health: 'ready' as const,
    })),
    tools,
    mcpServers: [],
    agents,
    pipelines: [],
    comparators: [{ kind: 'text', description: '' }],
    workspace: emptyWorkspaceContext('imjang-note'),
  };
}

describe('P4-A.11 관련 자산 추리기 (로컬 BM25)', () => {
  it('200개 자산에서 상위 40개 + 엔진 전부', () => {
    const inv = bigInventory();
    const r = pickRelevant(
      inv,
      '임장노트 화면 디자인 검수 에이전트 만들어 줘. Kotlin Compose 앱이고 스크린샷 비교도 해 줘',
    );
    expect(r.total).toBe(200);
    expect(DEFAULT_PICK_LIMIT).toBe(40);
    expect(r.picked).toHaveLength(40);
    const kept = r.inventory.skills.length + r.inventory.tools.length + r.inventory.agents.length;
    expect(kept).toBe(40);
    // 엔진·비교기·워크스페이스는 전부 유지
    expect(r.inventory.engines).toHaveLength(4);
    expect(r.inventory.comparators).toEqual(inv.comparators);
    expect(r.inventory.workspace).toEqual(inv.workspace);
    // 관련 자산이 맨 앞
    const top = r.picked.slice(0, 4).map((p) => p.id);
    expect(top).toEqual(
      expect.arrayContaining(['kotlin-compose', 'ui-audit', 'screenshot-diff', 'design-qa']),
    );
    expect(r.picked[0]!.score).toBeGreaterThan(0);
    // 점수 내림차순
    for (let i = 1; i < r.picked.length; i++)
      expect(r.picked[i]!.score).toBeLessThanOrEqual(r.picked[i - 1]!.score);
  });

  it('자산이 40개 이하면 전부 그대로, 원본은 바뀌지 않음', () => {
    const inv = bigInventory();
    const small = { ...inv, skills: inv.skills.slice(0, 10), tools: inv.tools.slice(0, 5), agents: [] };
    const r = pickRelevant(small, '아무 요청');
    expect(r.inventory.skills).toHaveLength(10);
    expect(r.inventory.tools).toHaveLength(5);
    expect(inv.skills).toHaveLength(120);
  });

  it('bm25: 일치하는 단어가 많을수록 높은 점수, 빈 질의는 0', () => {
    const s = bm25Scores('화면 검수', [['화면', '검수'], ['화면'], ['메일']]);
    expect(s[0]).toBeGreaterThan(s[1]!);
    expect(s[2]).toBe(0);
    expect(bm25Scores('', [['a']])).toEqual([0]);
  });
});
