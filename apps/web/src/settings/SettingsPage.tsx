import { useMemo, type ReactNode } from 'react';
import type { HarnessApiClient, PickFolderResponse } from '../api/client.js';
import type { EngineOption } from '../composer/types.js';
import { enginesApi } from './Engines/api.js';
import { EnginesSettings } from './Engines/EnginesSettings.js';
import { settingsApi, type SettingsWidgetContext } from './form/api.js';
import { SettingsScreen } from './SettingsScreen.js';

/**
 * T-101 6번 설정 화면을 앱에 붙이는 곳 (App.tsx는 이 컴포넌트 한 줄만 쓴다).
 * 서버 API(client)로 설정 API·맞춤 위젯 함수·탭별 덧붙임 화면을 만든다.
 */

export interface SettingsPageProps {
  client: Pick<HarnessApiClient, 'request'> & {
    pickFolder?: (initialPath?: string) => Promise<PickFolderResponse>;
  };
  /** 감지된 엔진 (엔진·모델 선택기) */
  engines?: readonly EngineOption[];
  /** 데스크톱 앱이면 OS 폴더 대화상자 */
  pickFolder?: (initialPath?: string) => Promise<PickFolderResponse>;
  initialTab?: string;
  project?: string;
  projectName?: string;
  /** 탭별 덧붙임 화면 (기본 것 위에 덮어씀) */
  sections?: Readonly<Partial<Record<string, ReactNode>>>;
}

export function SettingsPage(props: SettingsPageProps) {
  const { client, engines } = props;
  const api = useMemo(() => settingsApi(client), [client]);
  const engApi = useMemo(() => enginesApi(client), [client]);
  const pick = props.pickFolder ?? client.pickFolder?.bind(client);
  const ctx = useMemo<SettingsWidgetContext>(
    () => ({
      listEngines: async () => (engines ?? []).map((e) => ({ id: e.id, displayName: e.label })),
      ...(pick ? { pickFolder: pick } : {}),
      // 6B.2 엔진 카드(T-038 설정 > 엔진 화면)를 AI·엔진 탭의 '엔진별 로그인과 모델' 항목으로 옮김
      renderEngineSettings: () => <EnginesSettings api={engApi} />,
    }),
    [engines, pick, engApi],
  );
  return (
    <SettingsScreen
      api={api}
      ctx={ctx}
      {...(props.initialTab ? { initialTab: props.initialTab } : {})}
      {...(props.project ? { project: props.project } : {})}
      {...(props.projectName ? { projectName: props.projectName } : {})}
      {...(props.sections ? { sections: props.sections } : {})}
    />
  );
}
