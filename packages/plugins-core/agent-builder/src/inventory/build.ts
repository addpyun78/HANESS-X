import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { readEnginesCache, type EnginesCache } from '@harness-x/engine-scanner';
import { harnessHome } from '@harness-x/kernel';
import type { RegisteredAgent } from '../registry.js';
import { collectAgents, collectPipelines } from './agents.js';
import { collectComparators } from './comparators.js';
import { collectEngines, type EngineFacts } from './engines.js';
import { sanitizeDeep } from './filter.js';
import { collectPlugins, type InventoryPluginSource } from './plugins.js';
import { InventorySchema, type AssetHealth, type Inventory } from './schema.js';
import { collectSkills } from './skills.js';
import { collectMcpServers, collectTools, defaultToolRegistryFile, readToolRegistry } from './tools.js';
import { guessWorkspace } from './workspace.js';

/** 인벤토리 재료 (모두 선택 — 없는 것은 빈 목록) */
export interface InventorySources {
  /** 로더 플러그인 (예: () => loader.plugins.values()). 매니페스트만 읽는다 */
  plugins?: () => Iterable<InventoryPluginSource>;
  /** 에이전트 레지스트리 목록 (GET /api/agents와 같은 출처) */
  agents?: () => readonly RegisteredAgent[];
  /** 엔진 탐지 캐시 (기본: <home>/engines.json) */
  engines?: () => EnginesCache | null;
  /** 엔진 로그인·모드·쿼터 */
  engineFacts?: () => EngineFacts | Promise<EngineFacts>;
  /** 하네스 홈 (기본 harnessHome()) */
  home?: string;
  /** 도구 목록 파일 (기본 <home>/tools/registry.json) */
  toolRegistryFile?: string;
  /** 플러그인 밖 스킬 폴더 (기본 [<home>/skills]) */
  skillRoots?: readonly string[];
  /** 현재 워크스페이스 */
  workspace?: string | (() => string | undefined);
  /** 비교기 종류 (기본 고정 8종) */
  comparatorKinds?: () => readonly string[];
  now?: () => Date;
}

/** 같은 id 엔진이 여러 위치에 있으면 가장 좋은 상태를 쓴다 */
function engineHealthMap(engines: Inventory['engines']): Map<string, AssetHealth> {
  const m = new Map<string, AssetHealth>();
  const order: AssetHealth[] = ['ready', 'outdated', 'needs-login', 'disabled'];
  for (const e of engines) {
    const cur = m.get(e.id);
    if (!cur || order.indexOf(e.health) < order.indexOf(cur)) m.set(e.id, e.health);
  }
  return m;
}

/** 스냅샷 1개 만들기: 수집 → 비밀·코드 필터 → 스키마 검증 */
export async function buildInventory(src: InventorySources = {}): Promise<Inventory> {
  const home = src.home ?? harnessHome();
  const plugins = [...(src.plugins?.() ?? [])];
  const cache = src.engines ? src.engines() : readEnginesCache(join(home, 'engines.json'));
  const engines = collectEngines(cache, (await src.engineFacts?.()) ?? {});
  const eh = engineHealthMap(engines);
  const ws = typeof src.workspace === 'function' ? src.workspace() : src.workspace;
  const toolFile =
    src.toolRegistryFile ?? (src.home ? join(home, 'tools', 'registry.json') : defaultToolRegistryFile());
  const raw: Inventory = {
    snapshotId: randomUUID(),
    createdAt: (src.now?.() ?? new Date()).toISOString(),
    plugins: collectPlugins(plugins),
    skills: collectSkills(plugins, { skillRoots: src.skillRoots ?? [join(home, 'skills')] }),
    engines,
    tools: collectTools(readToolRegistry(toolFile), plugins),
    mcpServers: collectMcpServers(plugins),
    agents: collectAgents(src.agents?.() ?? [], eh),
    pipelines: collectPipelines(plugins, eh),
    comparators: collectComparators(src.comparatorKinds?.()),
    workspace: guessWorkspace(ws),
  };
  return InventorySchema.parse(sanitizeDeep(raw));
}

/** 화면용 한 줄 요약 ("스킬 23개, 엔진 4개 사용 가능") — 사용 가능 = ready */
export function inventorySummary(inv: Inventory): string {
  const skills = inv.skills.filter((s) => s.health === 'ready').length;
  // 같은 엔진이 Windows·WSL 양쪽에 있어도 1개로 센다
  const engines = new Set(inv.engines.filter((e) => e.health === 'ready').map((e) => e.id)).size;
  return `스킬 ${skills}개, 엔진 ${engines}개 사용 가능`;
}
