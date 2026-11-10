import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { LogRecord } from '@harness-x/kernel';
import { PluginManifestSchema, type PluginManifest } from '@harness-x/protocol';
import type { Forge, ForgeRunInput } from './engine.js';
import { createForge } from './forge.js';
import { registerForgeRoutes, type RouteHost } from './routes.js';

export * from './spec.js';
export * from './interview.js';
export * from './broker.js';
export * from './scaffold.js';
export * from './engine.js';
export * from './routes.js';
export * from './check.js';
export * from './sandbox.js';
export * from './install.js';
export * from './forge.js';

/** 이 플러그인 폴더 (src/와 dist/ 모두 한 단계 아래) */
export const FORGE_PLUGIN_DIR = fileURLToPath(new URL('..', import.meta.url));

/** 레지스트리용 플러그인 정보 (AgentRegistry plugins에 넣으면 /forge 에이전트가 생긴다) */
export function forgePlugin(): { manifest: PluginManifest; dir: string; state: string } {
  const manifest = PluginManifestSchema.parse(
    JSON.parse(readFileSync(new URL('../harness-plugin.json', import.meta.url), 'utf8')),
  );
  return { manifest, dir: FORGE_PLUGIN_DIR, state: 'active' };
}

// ── 커널(cli.ts)이 로드된 플러그인 모듈로 부르는 함수 ──────────
// 커널은 forge를 import하지 않는다: /forge 세션이면 실행기 옵션을, 서버 기동 시 카드 응답 라우트를 여기서 받는다.
let shared: Forge | undefined;

/** 프로세스 공용 Forge (기본 검사·시험·설치기, 첫 호출의 log를 쓴다) */
export function forgeService(opts: { log?: { append(rec: LogRecord): unknown }; home?: string } = {}): Forge {
  shared ??= createForge({
    ...(opts.log ? { log: opts.log } : {}),
    ...(opts.home ? { home: opts.home } : {}),
  });
  return shared;
}

/** /forge 파이프라인 실행기 옵션 (engines·defaultEngine·verify·checklists) */
export function forgeRunnerOptionsFor(
  input: ForgeRunInput & { log?: { append(rec: LogRecord): unknown }; home?: string },
) {
  const { log, home, ...run } = input;
  return forgeService({ ...(log ? { log } : {}), ...(home ? { home } : {}) }).runnerOptions(run);
}

/** GET /api/forge/pending, POST /api/forge/answers/:id */
export function registerForgeApi(
  app: RouteHost,
  opts: { log?: { append(rec: LogRecord): unknown } } = {},
): void {
  registerForgeRoutes(app, forgeService(opts).broker);
}

/** 하네스 플러그인 진입점 */
export function activate(ctx: { log(message: string): void }): void {
  ctx.log('forge active (/forge)');
}
