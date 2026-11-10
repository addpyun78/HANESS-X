import { harnessHome, type LogRecord } from '@harness-x/kernel';
import { ForgeBroker } from './broker.js';
import { runChecks } from './check.js';
import { Forge } from './engine.js';
import { buildInstallCard, installPlugin, type InstallResult } from './install.js';
import { checkGate, testGate, type SandboxOptions } from './sandbox.js';

/**
 * 기본 Forge: 정적 검사(check gate) + 샌드박스 시험(test gate) + 설치 카드·설치(install 노드)
 * home은 설치 위치의 하네스 홈 (기본 harnessHome() — HARNESS_X_HOME 존중, 호출 시점에 읽는다)
 */
export interface CreateForgeOptions {
  broker?: ForgeBroker;
  log?: { append(rec: LogRecord): unknown };
  home?: string;
  sandbox?: SandboxOptions;
  /** 설치 직후 (예: 로더에 새 플러그인 등록) */
  onInstalled?: (r: InstallResult) => void | Promise<void>;
}

export function createForge(o: CreateForgeOptions = {}): Forge {
  const home = () => o.home ?? harnessHome();
  return new Forge({
    broker: o.broker ?? new ForgeBroker({ ...(o.log ? { log: o.log } : {}) }),
    ...(o.log ? { log: o.log } : {}),
    check: checkGate,
    test: (s) => testGate(s, o.sandbox),
    installer: {
      card: (s) => {
        const { suggestions } = runChecks(s.pluginDir, s.spec);
        return { ...buildInstallCard(s.pluginDir, { home: home(), suggestions }) };
      },
      install: async (s) => {
        const r = installPlugin(s.pluginDir, {
          home: home(),
          message: `forge: install ${s.spec?.id} (${s.sessionId})`,
        });
        await o.onInstalled?.(r);
        return r;
      },
    },
  });
}
