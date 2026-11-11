import { useMemo, type ReactNode } from 'react';
import type { HarnessApiClient } from '../api/client.js';
import { engineScanApi, type EngineScanApi } from './api.js';
import { ModelButton } from './ModelButton.js';
import { ScanBubble } from './ScanBubble.js';
import { useEngineScan, type EngineScanState } from './useEngineScan.js';
import { useMainAi, type MainAiState, type ProjectDefaults } from './useMainAi.js';

export interface UseEnginesOptions {
  client?: Pick<HarnessApiClient, 'request'> | undefined;
  /** 테스트·데모용 API 교체 */
  api?: EngineScanApi;
  events?: readonly { type: string }[];
  sessionId?: string;
  /** 0B.40 프로젝트 기본 AI (0-2 프로젝트 기능이 주입) */
  project?: ProjectDefaults;
  onOpenInstall?: () => void;
  onLogin?: (engineId: string) => void;
}

export interface EnginesUi {
  scan: EngineScanState;
  main: MainAiState;
  /** 화면 가운데 말풍선 (App이 본문에 한 번 그린다) */
  bubble: ReactNode;
  /** 입력창 오른쪽 아래 [엔진 · 모델 ▾] */
  button: ReactNode;
}

/** T-101 5 엔진 자동 탐지 말풍선 + 모델 선택 버튼 묶음 (App에는 이 훅 한 번 + 두 요소만 붙인다) */
export function useEngines(o: UseEnginesOptions): EnginesUi {
  const { client, api: given } = o;
  const api = useMemo(() => given ?? (client ? engineScanApi(client) : undefined), [given, client]);
  const scan = useEngineScan(api, o.events);
  const main = useMainAi(api, {
    ...(o.sessionId ? { sessionId: o.sessionId } : {}),
    ...(o.project ? { project: o.project } : {}),
    generation: scan.generation,
  });
  const bubble = (
    <ScanBubble
      phase={scan.phase}
      progress={scan.progress}
      {...(o.onOpenInstall ? { onOpenInstall: o.onOpenInstall } : {})}
      onDismiss={scan.dismiss}
    />
  );
  const button = (
    <ModelButton
      models={main.models}
      current={main.current}
      from={main.from}
      hasProject={!!o.project}
      onChoose={(c, s) => void main.choose(c, s)}
      {...(o.onLogin ? { onLogin: o.onLogin } : {})}
    />
  );
  return { scan, main, bubble, button };
}
