import { NODE_TYPES, type ModelsResponse, type NodeType, type PipelineInput } from '@harness-x/protocol';
import type { HarnessApiClient } from '../api/client.js';
import { enginesFromPlugins } from '../composer/engines.js';
import { NODE_LABEL } from './graph.js';
import { engineBlocksFromModels } from '../engines/model.js';

/** 빌더 서랍·시작 선택이 쓰는 블록 목록 */

export interface CatalogItem {
  id: string;
  label: string;
  description?: string;
}

export interface CatalogPlugin extends CatalogItem {
  /** 플러그인이 제공하는 파이프라인 (없으면 펼칠 수 없음) */
  pipeline?: PipelineInput;
}

export interface CatalogAgent extends CatalogItem {
  icon?: string;
  nodeCount?: number;
  pipeline?: PipelineInput;
}

export interface BuilderCatalog {
  plugins: CatalogPlugin[];
  agents: CatalogAgent[];
  skills: CatalogItem[];
  engines: CatalogItem[];
  tools: CatalogItem[];
  /** T-101 5D 지금 메인 AI 엔진 (노드 칩 `메인(claude-code)` 표시·직접 고르기 전환용) */
  mainEngine?: string;
}

export const DRAWER_TABS = ['node', 'plugin', 'skill', 'engine', 'tool'] as const;
export type DrawerTab = (typeof DRAWER_TABS)[number];
export const DRAWER_TAB_LABEL: Record<DrawerTab, string> = {
  node: '노드',
  plugin: '플러그인',
  skill: '스킬',
  engine: '엔진',
  tool: '도구',
};

export const NODE_DESC: Record<NodeType, string> = {
  role: '엔진 세션 하나가 맡는 세부 담당',
  gate: '판정기로 검사, 실패 항목만 되돌림',
  fanout: '나가는 갈래를 병렬 실행',
  join: '들어오는 갈래를 모음',
  loop: '조건을 만족할 때까지 반복',
  router: '조건으로 한 갈래를 고름',
  subagent: '다른 에이전트를 노드로 호출',
};

/** 서랍에서 끄는 블록 (dataTransfer로 캔버스·노드에 전달) */
export interface DrawerBlock {
  kind: DrawerTab;
  id: string;
  label: string;
  description?: string;
}

export const BLOCK_MIME = 'application/x-hx-block';
/** dragover 중에는 데이터를 읽을 수 없으므로 블록 종류를 MIME 이름으로도 실어 보낸다 */
export const blockKindMime = (kind: DrawerTab) => `${BLOCK_MIME}-${kind}`;

export function drawerBlocks(c: BuilderCatalog, tab: DrawerTab): DrawerBlock[] {
  const items = (kind: DrawerTab, xs: CatalogItem[]) =>
    xs.map((x) => ({
      kind,
      id: x.id,
      label: x.label,
      ...(x.description ? { description: x.description } : {}),
    }));
  switch (tab) {
    case 'node':
      return NODE_TYPES.map((t) => ({
        kind: 'node',
        id: t,
        label: NODE_LABEL[t],
        description: NODE_DESC[t],
      }));
    case 'plugin':
      return items('plugin', c.plugins);
    case 'skill':
      return items('skill', c.skills);
    case 'engine':
      return items('engine', c.engines);
    case 'tool':
      return items('tool', c.tools);
  }
}

/** 서랍 검색: 이름·id·설명에 검색어(공백으로 나눈 낱말 모두)가 들어 있는 블록 */
export function filterBlocks(blocks: DrawerBlock[], query: string): DrawerBlock[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return blocks;
  return blocks.filter((b) => {
    const hay = `${b.label} ${b.id} ${b.description ?? ''}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

// ── 기본(데모) 카탈로그: API가 없을 때나 ?demo에서 쓴다 ────────────
const DESIGN_QA: PipelineInput = {
  name: 'design-qa',
  displayName: '디자인 QA',
  entry: 'plan',
  nodes: [
    {
      id: 'plan',
      type: 'role',
      label: '계획',
      engine: 'claude-code',
      skills: ['design-brief'],
      tools: ['fs'],
      permission: 'read-only',
      outputSchema: {
        type: 'object',
        properties: { tasks: { type: 'array', items: { type: 'string' } } },
        required: ['tasks'],
      },
    },
    {
      id: 'build',
      type: 'role',
      label: '구현',
      engine: 'codex',
      skills: ['frontend-design'],
      tools: ['fs', 'shell'],
      inputSchema: {
        type: 'object',
        properties: { tasks: { type: 'array', items: { type: 'string' } } },
        required: ['tasks'],
      },
      outputSchema: {
        type: 'object',
        properties: { changedFiles: { type: 'array', items: { type: 'string' } } },
        required: ['changedFiles'],
      },
    },
    {
      id: 'critic',
      type: 'role',
      label: '비평',
      engine: 'antigravity',
      skills: ['design-critique', 'a11y-check'],
      tools: ['fs'],
      permission: 'read-only',
      inputSchema: {
        type: 'object',
        properties: { changedFiles: { type: 'array', items: { type: 'string' } } },
        required: ['changedFiles'],
      },
    },
  ],
  edges: [
    { from: 'plan', to: 'build' },
    { from: 'build', to: 'critic' },
  ],
};

const REVIEW: PipelineInput = {
  name: 'code-review',
  displayName: '코드 리뷰',
  nodes: [
    {
      id: 'review',
      type: 'role',
      label: '리뷰',
      engine: 'claude-code',
      skills: ['code-review'],
      tools: ['fs'],
    },
    { id: 'verify', type: 'gate', label: '검증', verifiers: ['ladder'] },
  ],
  edges: [
    { from: 'review', to: 'verify' },
    { from: 'verify', to: 'review', onFail: true },
  ],
};

export const DEFAULT_CATALOG: BuilderCatalog = {
  plugins: [
    { id: 'design-qa', label: '디자인 QA', description: '계획 → 구현 → 비평', pipeline: DESIGN_QA },
    { id: 'code-review', label: '코드 리뷰', description: '리뷰 → 검증 게이트', pipeline: REVIEW },
  ],
  agents: [
    {
      id: 'design-qa',
      label: '디자인 QA',
      icon: '🎨',
      description: '계획 → 구현 → 비평 3단계',
      nodeCount: 3,
      pipeline: DESIGN_QA,
    },
  ],
  skills: [
    { id: 'design-brief', label: '디자인 브리프', description: '요구를 화면 단위로 정리' },
    { id: 'frontend-design', label: '프론트엔드 디자인', description: '컴포넌트·스타일 구현' },
    { id: 'design-critique', label: '디자인 비평', description: '원칙 기반 비평' },
    { id: 'a11y-check', label: '접근성 검사', description: 'WCAG 점검' },
    { id: 'code-review', label: '코드 리뷰', description: '정확성·보안 검토' },
  ],
  engines: [
    { id: 'auto', label: '자동', description: '라우팅에 맡김' },
    { id: 'claude-code', label: 'Claude Code' },
    { id: 'codex', label: 'Codex' },
    { id: 'antigravity', label: 'Antigravity' },
  ],
  tools: [
    { id: 'fs', label: '파일', description: '읽기·쓰기' },
    { id: 'shell', label: '셸', description: '명령 실행' },
    { id: 'web', label: '웹', description: '검색·가져오기' },
  ],
};

/**
 * 하네스 API에서 카탈로그 채우기: /api/agents(에이전트), /api/plugins(플러그인·엔진·스킬).
 * API가 파이프라인 본문을 주지 않으므로 같은 id의 기본 카탈로그 파이프라인으로 보충한다.
 */
export async function loadCatalog(client: HarnessApiClient): Promise<BuilderCatalog> {
  const [agentsRes, pluginsRes, modelsRes, mainRes] = await Promise.all([
    client.agents(),
    client.plugins(),
    // T-101 5D.1 엔진 탭 = 입력창 모델 목록(/api/models, 자동 탐지 결과·배지)과 같은 데이터
    client.request<ModelsResponse>('/api/models').catch(() => undefined),
    client.request<{ main: { engine: string } | null }>('/api/main-ai').catch(() => undefined),
  ]);
  const known = (id: string) => DEFAULT_CATALOG.plugins.find((p) => p.id === id)?.pipeline;
  const engines = enginesFromPlugins(pluginsRes).map((e) => ({ id: e.id, label: e.label }));
  const skillPlugins = pluginsRes.plugins.filter((p) => p.slots.includes('skill'));
  return {
    plugins: pluginsRes.plugins
      .filter((p) => p.provides && 'pipeline' in p.provides)
      .map((p) => ({
        id: p.id,
        label: p.displayName || p.id,
        description: p.description,
        pipeline: known(p.id),
      })),
    agents: agentsRes.agents.map((a) => ({
      id: a.name,
      label: a.displayName,
      description: a.description,
      icon: a.icon,
      nodeCount: a.nodeCount,
      pipeline: known(a.name),
    })),
    skills: skillPlugins.length
      ? skillPlugins.map((p) => ({ id: p.id, label: p.displayName || p.id, description: p.description }))
      : DEFAULT_CATALOG.skills,
    engines: modelsRes?.models.length
      ? engineBlocksFromModels(modelsRes.models)
      : [DEFAULT_CATALOG.engines[0]!, ...engines],
    tools: DEFAULT_CATALOG.tools,
    ...(mainRes?.main?.engine ? { mainEngine: mainRes.main.engine } : {}),
  };
}
