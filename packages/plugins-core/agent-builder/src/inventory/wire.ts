import { join } from 'node:path';
import { harnessHome } from '@harness-x/kernel';
import type { RegisteredAgent } from '../registry.js';
import type { InventoryPluginSource } from './plugins.js';
import { registerInventoryRoute, type InventoryRouteHost } from './route.js';
import { InventoryService } from './service.js';
import type { InventorySources } from './build.js';

/**
 * 커널(cli.ts)이 agent-builder 모듈을 구조적으로 불러 쓰는 진입점.
 * 인벤토리 서비스를 만들고 GET /api/builder/inventory를 등록하고 engines.json을 감시한다.
 * 플러그인 핫리로드는 반환값의 attachHotReload(reloader)로 연결한다.
 */
export interface BuilderInventoryOptions {
  plugins: () => Iterable<InventoryPluginSource>;
  agents?: () => readonly unknown[];
  home?: string;
  workspace?: string;
  /** 엔진 로그인 상태·쿼터 (커널의 공식 상태 명령 결과). 없으면 unknown */
  engineFacts?: InventorySources['engineFacts'];
}

export function registerBuilderInventory(
  app: InventoryRouteHost,
  o: BuilderInventoryOptions,
): InventoryService {
  const home = o.home ?? harnessHome();
  const svc = new InventoryService({
    plugins: o.plugins,
    ...(o.agents ? { agents: () => (o.agents?.() ?? []) as readonly RegisteredAgent[] } : {}),
    home,
    ...(o.workspace ? { workspace: o.workspace } : {}),
    ...(o.engineFacts ? { engineFacts: o.engineFacts } : {}),
  });
  svc.on('error', () => undefined); // 재생성 실패는 다음 요청에서 다시 시도
  svc.watchEnginesCache(join(home, 'engines.json'));
  registerInventoryRoute(app, svc);
  return svc;
}
