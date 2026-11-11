import { useMemo, useState, type ReactNode } from 'react';
import type { HarnessApiClient, PickFolderResponse } from '../api/client.js';
import type { EngineOption } from '../composer/types.js';
import type { ProjectView } from '../shell/projects/api.js';
import type { ProjectAction } from '../shell/projects/ProjectSidebar.js';
import { enginesApi } from './Engines/api.js';
import { EnginesSettings } from './Engines/EnginesSettings.js';
import { settingsApi, type SettingsWidgetContext } from './form/api.js';
import { AboutSection } from './sections/AboutSection.js';
import { settingsExtrasApi } from './sections/api.js';
import { DataSection, type EngineKeySource } from './sections/DataSection.js';
import { ProjectsSection } from './sections/ProjectsSection.js';
import { TransferSection } from './sections/TransferSection.js';
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
  /** 6B.10 프로젝트 목록 (0-2가 켜져 있을 때) — 동작은 사이드바와 같은 projectAction */
  projects?: { list: readonly ProjectView[]; onAction: (p: ProjectView, a: ProjectAction) => void };
  /** 탭별 덧붙임 화면 (기본 것 위에 덮어씀) */
  sections?: Readonly<Partial<Record<string, ReactNode>>>;
}

export function SettingsPage(props: SettingsPageProps) {
  const { client, engines } = props;
  const api = useMemo(() => settingsApi(client), [client]);
  const extras = useMemo(() => settingsExtrasApi(client), [client]);
  const engApi = useMemo(() => enginesApi(client), [client]);
  const [version, setVersion] = useState(0);
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
  const engineKeys = useMemo<EngineKeySource>(
    () => ({
      list: async () => {
        const r = await engApi.list();
        const label = (id: string) =>
          r.adapters?.find((a) => a.id === id)?.displayName ?? engines?.find((e) => e.id === id)?.label ?? id;
        return Object.entries(r.keys).flatMap(([id, k]) =>
          k ? [{ id, label: label(id), masked: k.masked }] : [],
        );
      },
      remove: (id) => engApi.deleteKey(id),
    }),
    [engApi, engines],
  );
  const sections = useMemo(
    () => ({
      ...(props.projects
        ? { project: <ProjectsSection projects={props.projects.list} onAction={props.projects.onAction} /> }
        : {}),
      data: (
        <>
          <DataSection key={version} api={api} extras={extras} engineKeys={engineKeys} />
          <TransferSection extras={extras} onImported={() => setVersion((v) => v + 1)} />
        </>
      ),
      about: <AboutSection extras={extras} />,
      ...props.sections,
    }),
    [props.projects, props.sections, api, extras, engineKeys, version],
  );
  return (
    <SettingsScreen
      api={api}
      ctx={ctx}
      sections={sections}
      version={version}
      {...(props.initialTab ? { initialTab: props.initialTab } : {})}
      {...(props.project ? { project: props.project } : {})}
      {...(props.projectName ? { projectName: props.projectName } : {})}
    />
  );
}
