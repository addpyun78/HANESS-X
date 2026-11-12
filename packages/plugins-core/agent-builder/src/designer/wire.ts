import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HumanGestureTokens } from '@harness-x/kernel';
import type { Inventory } from '../inventory/schema.js';
import { registerBuilderDesigner, type DesignerRouteHost } from './route.js';
import { createDesignerSession } from './session.js';
import { parseBuilderSettings, resolveDesignerEngine, type BuilderSettings } from './settings.js';
import { readyEngines } from './engines.js';

/**
 * 커널(cli.ts)이 agent-builder 모듈을 구조적으로 불러 쓰는 진입점 (P4-C.1/C.2 연결).
 * 설정 <home>/settings.json 의 builder.* → 설계 엔진(builder.engine, 비어 있으면 첫 준비된 엔진 = 세션 기본)
 * 엔진 상태는 인벤토리(engine-scanner 결과)에서 가져온다. 설계 세션은 도구 없는 읽기 전용 1회 실행.
 */

export interface BuilderDesignerWireOptions {
  home: string;
  inventory: { get(): Promise<Inventory> };
  gestures: Pick<HumanGestureTokens, 'consume'>;
  agents: () => readonly { name: string; command: string }[];
  /** 세션 기본 엔진 (없으면 인벤토리의 첫 준비된 엔진) */
  sessionDefault?: () => string | undefined;
  onSaved?: (s: { name: string; command: string; dir: string }) => void;
}

/** T-101 5D.5 메인 AI 엔진 (settings.json `main.engine` — 설정 레지스트리 등록은 0A.3/6B.2에서) */
export function readMainEngine(home: string): string | undefined {
  const f = join(home, 'settings.json');
  try {
    if (!existsSync(f)) return undefined;
    const cfg = JSON.parse(readFileSync(f, 'utf8')) as Record<string, unknown>;
    const v = cfg['main.engine'] ?? (cfg.main as { engine?: unknown } | undefined)?.engine;
    return typeof v === 'string' && v.trim() ? v.trim() : undefined;
  } catch {
    return undefined;
  }
}

export function readBuilderSettings(home: string): BuilderSettings {
  const f = join(home, 'settings.json');
  try {
    if (existsSync(f))
      return parseBuilderSettings(
        (JSON.parse(readFileSync(f, 'utf8')) as { builder?: unknown }).builder ?? {},
      );
  } catch {
    // 잘못된 설정은 기본값으로
  }
  return parseBuilderSettings({});
}

export function registerBuilderDesignerRoutes(app: DesignerRouteHost, o: BuilderDesignerWireOptions) {
  return registerBuilderDesigner(app, {
    home: o.home,
    inventory: () => o.inventory.get(),
    settings: () => readBuilderSettings(o.home),
    gestures: o.gestures,
    agents: o.agents,
    ...(o.onSaved ? { onSaved: o.onSaved } : {}),
    session: async () => {
      const inv = await o.inventory.get();
      const settings = readBuilderSettings(o.home);
      const detected = inv.engines.filter((e) => e.installed).map((e) => e.id);
      const choice = resolveDesignerEngine(
        settings,
        detected,
        o.sessionDefault?.() ?? readyEngines(inv)[0],
        readMainEngine(o.home),
      );
      const e = choice.engineId ? inv.engines.find((x) => x.id === choice.engineId) : undefined;
      if (!e) return undefined;
      const s = createDesignerSession({
        id: e.id,
        detected: e.installed,
        loggedIn: e.login === 'loggedIn',
        authMode: e.mode === 'apiKey' ? 'apiKey' : 'subscription',
        command: e.binary,
      });
      return { ask: s.ask, engineId: s.engineId };
    },
  });
}
