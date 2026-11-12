/**
 * T-101 0C.4·0C.5 "전부 눌러 보기" 화면별 그리기 (id = e2e/screens.ts).
 * 서버는 모두 모킹: App은 fetch·WebSocket 스텁(h.server), 화면 컴포넌트는 가짜 API(h.api)·콜백(h.cb).
 */
import type { HarnessEvent } from '@harness-x/protocol';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from '../../src/App.js';
import { BuilderPage } from '../../src/builder/BuilderPage.js';
import { DEFAULT_CATALOG } from '../../src/builder/catalog.js';
import { ChatStream } from '../../src/chat/ChatStream.js';
import { Composer } from '../../src/composer/Composer.js';
import { StopButton } from '../../src/composer/StopButton.js';
import { SubagentConfirm } from '../../src/composer/SubagentConfirm.js';
import { ModelButton } from '../../src/engines/ModelButton.js';
import { ScanBubble } from '../../src/engines/ScanBubble.js';
import { ForgeAnswerContext } from '../../src/forge/ForgeCards.js';
import type { InstallApi } from '../../src/install/api.js';
import { FirstRunCard, firstRunsFromEvents } from '../../src/install/FirstRunCard.js';
import { InstallManager } from '../../src/install/InstallManager.js';
import { InstallPlanCard } from '../../src/install/InstallPlanCard.js';
import type { CandidateView, InstallPlanView } from '../../src/install/model.js';
import { ChecklistPanel } from '../../src/panels/Checklist/ChecklistPanel.js';
import { ToolPickerCard } from '../../src/panels/ToolPicker/ToolPickerCard.js';
import { ProjectResumeCard } from '../../src/recovery/ProjectResumeCard.js';
import { ResumeCard } from '../../src/recovery/ResumeCard.js';
import { ResumeCheckCard, type ResumeIssueData } from '../../src/recovery/ResumeCheckCard.js';
import { ResumeFlow } from '../../src/recovery/ResumeFlow.js';
import { ResumeCountLink } from '../../src/recovery/resume-entry.js';
import { EnginesSettings } from '../../src/settings/Engines/EnginesSettings.js';
import { SettingsForm } from '../../src/settings/form/SettingsForm.js';
import { AboutSection } from '../../src/settings/sections/AboutSection.js';
import { DataSection } from '../../src/settings/sections/DataSection.js';
import { ProjectsSection } from '../../src/settings/sections/ProjectsSection.js';
import { TransferSection } from '../../src/settings/sections/TransferSection.js';
import { SettingsScreen } from '../../src/settings/SettingsScreen.js';
import type { ProjectView, SessionRecordView } from '../../src/shell/projects/api.js';
import { ConfirmCard } from '../../src/shell/projects/ConfirmCard.js';
import { EmptySession } from '../../src/shell/projects/EmptySession.js';
import { ProjectSettings } from '../../src/shell/projects/ProjectSettings.js';
import { ProjectSidebar } from '../../src/shell/projects/ProjectSidebar.js';
import { DEFAULT_PREFS, type SidebarPrefs } from '../../src/shell/projects/prefs.js';
import { RootSuggestCard, WhereToWork } from '../../src/shell/projects/WhereToWork.js';
import { StopAllButton } from '../../src/shell/StopAllButton.js';
import { memorySettings } from '../settings-form-fixtures.js';
import { fixtureCard, requestEvent } from '../approvals-fixtures.js';
import { ev, fakeApi as checklistApi, view } from '../checklist-fixtures.js';
import { DRAFT_CATALOG, fakeDesignerApi, QUESTIONS, sampleDraft } from '../draft-fixtures.js';
import { blockTransfer } from '../flow-mock.js';
import { NINE_EVENTS, STOP_BLOCK_EVENT } from '../fixtures/events.js';
import { done as scanDone, MODELS } from '../engines-fixtures.js';
import { fixturePlan, fixtureTool } from '../install-fixtures.js';
import { fakeApi as enginesApi } from '../settings-fixtures.js';
import { pickerData } from '../toolpicker-fixtures.js';
import type { Harness, Renderer } from './click-all.js';

const TS = '2026-11-12T00:00:00.000Z';
const APP_WS = {
  name: 'app',
  path: '/mnt/c/work/app',
  lastUsedAt: TS,
  git: true,
  branch: 'main',
  hasAgentsMd: true,
  hasClaudeMd: false,
};
const OLD_WS = { ...APP_WS, name: 'old', path: '/mnt/c/work/old', branch: undefined, pinned: true };
const ENGINE_PLUGINS = {
  plugins: [
    {
      id: 'claude-code',
      displayName: 'Claude Code',
      slots: ['engine'],
      state: 'active',
      provides: { engine: ['claude-code'] },
    },
    {
      id: 'codex',
      displayName: 'Codex',
      slots: ['engine'],
      state: 'active',
      provides: { engine: ['codex'] },
    },
  ],
  rejected: [],
};
const AGENTS = {
  agents: [
    { id: 'reviewer', name: 'reviewer', command: '/reviewer', description: '코드를 검토해요', icon: '🔍' },
  ],
};

/** 모킹 서버 위의 App (메인 화면) */
function app(h: Harness, events: readonly unknown[] = []) {
  history.replaceState(null, '', '/?token=t0k');
  h.server(
    {
      'GET /api/workspaces': () => ({ current: APP_WS, recent: [OLD_WS, APP_WS] }),
      'POST /api/workspaces/open': (b) => ({
        workspace: (b as { path?: string })?.path === OLD_WS.path ? OLD_WS : APP_WS,
        recent: [OLD_WS, APP_WS],
      }),
      'POST /api/workspaces/pin': () => ({ recent: [{ ...OLD_WS, pinned: false }, APP_WS] }),
      'POST /api/native/pick-folder': () => ({ cancelled: false, path: APP_WS.path }),
      'GET /api/plugins': () => ENGINE_PLUGINS,
      'GET /api/agents': () => AGENTS,
      'POST /api/sessions': () => ({ sessionId: 's-new', agent: 'reviewer', status: 'running' }),
    },
    events,
  );
  render(<App />);
}

const SESSION_EVENTS: unknown[] = [
  {
    id: 'sc1',
    ts: TS,
    sessionId: 's-agent',
    type: 'session_created',
    agent: 'reviewer',
    command: '/reviewer',
    prompt: '로그인 화면 검토',
    nodeCount: 2,
  },
  ...NINE_EVENTS,
];

function installApi(h: Harness): InstallApi {
  const cand = (id: string): CandidateView => ({
    kind: 'winget',
    target: { id, name: id },
    label: `${id} (winget)`,
    source: 'winget',
    trust: { level: '공식', reasons: [] },
  });
  return h.api<InstallApi>({
    search: async (query: string) => ({ query, candidates: [cand('ffmpeg')] }),
    resolve: async (url: string) => ({ input: url, candidates: [cand('jq')], recommended: cand('jq') }),
    plan: async (r: { kind: CandidateView['kind']; target: CandidateView['target'] }) =>
      fixturePlan({ id: `plan_${r.target.id}`, name: r.target.id, target: r.target.id }),
    getPlan: async (id: string) => fixturePlan({ id }),
    execute: async () => ({ jobId: 'j1', planId: 'p', status: 'running' }) as never,
    cancel: async () => ({}),
    uninstallPlan: async (toolId: string) => fixturePlan({ id: `un_${toolId}`, action: 'uninstall', toolId }),
    updates: async () => ({ checkedAt: TS, skipped: false, updates: [] as InstallPlanView[] }),
    tools: async () => ({ tools: [fixtureTool()] }),
    history: async () => ({ records: [] }),
  } as InstallApi);
}

let lastSettings: { dispose(): void } | undefined;

function memStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

const sink = (h: Harness) => ({ add: h.cb(), addFailure: h.cb() });

const forgeEvent = (n: number, detail: Record<string, unknown>, options: string[]): HarnessEvent =>
  ({
    id: `f${n}`,
    ts: TS,
    sessionId: 's1',
    type: 'approval_request',
    approvalId: `s1:q${n}`,
    kind: 'forge_question',
    title: `질문 ${n}`,
    options,
    detail,
  }) as unknown as HarnessEvent;

const firstRunEvent = {
  id: 'fr1',
  ts: TS,
  sessionId: 'tools',
  type: 'approval_request',
  approvalId: 'fr1',
  kind: 'tool.first-run',
  title: '새 도구를 처음 써요',
  detail: {
    toolId: 'winget:jqlang.jq',
    toolName: 'jq',
    command: 'jq . a.json',
    whatHappened: '방금 설치한 도구 "jq"을(를) 처음 실행하려고 해요.',
    whyAsking: '새 도구는 처음 한 번 사람이 허락해야 실행돼요.',
    timeoutNote: '5분 안에 고르지 않으면 실행하지 않아요.',
  },
  options: ['once', 'always', 'deny'],
};

function builder(h: Harness, props: Record<string, unknown> = {}) {
  history.replaceState(null, '', '/#/builder/new');
  render(
    <BuilderPage
      route="/builder/new"
      catalog={DEFAULT_CATALOG}
      saveAgent={h.api({ save: async () => ({ ok: true, command: '/new-agent', path: 'x' }) }).save as never}
      saveGestureToken={h.api({ t: async () => 'tok' }).t as never}
      dryRunStepMs={1}
      animate={false}
      autosaveMs={0}
      loadStt={() => Promise.resolve(undefined)}
      {...props}
    />,
  );
}

const NOW = new Date('2026-11-12T12:00:00.000Z');
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();
const proj = (id: string, name: string, extra: Partial<ProjectView> = {}): ProjectView => ({
  id,
  name,
  rootPath: `/mnt/c/work/${name}`,
  createdAt: ago(10_000),
  lastOpenedAt: ago(5_000),
  pinned: false,
  order: 0,
  missing: false,
  ...extra,
});
const sess = (
  id: string,
  projectId: string | null,
  extra: Partial<SessionRecordView> = {},
): SessionRecordView => ({
  id,
  projectId,
  title: `대화 ${id}`,
  titleLocked: false,
  status: 'idle',
  cwd: '/mnt/c/work',
  origin: 'ui',
  draft: false,
  messageCount: 1,
  archived: false,
  createdAt: ago(100),
  updatedAt: ago(10),
  lastActivityAt: ago(10),
  engine: 'claude-code',
  permission: 'workspace-write',
  ...extra,
});
const PROJECTS = [
  proj('p1', 'imjang-note', { pinned: true, branch: 'main', order: 0 }),
  proj('p2', 'harness-x', { branch: 'main', order: 1 }),
  proj('p3', 'a2a', { missing: true, order: 2 }),
];
const PSESSIONS = [
  sess('s1', 'p1', {
    title: 'design-qa',
    status: 'running',
    agent: 'design-qa',
    agentIcon: '🎨',
    lastActivityAt: ago(2),
  }),
  sess('s2', 'p1', { title: 'API 리팩터', status: 'needs-approval', lastActivityAt: ago(30) }),
  sess('d1', 'p1', { title: '끝난 일', status: 'done', lastActivityAt: ago(60 * 24 * 40) }),
  sess('s4', 'p2', { title: '하네스 작업', status: 'idle', lastActivityAt: ago(60 * 24 * 3) }),
];

function projectSidebar(h: Harness) {
  let prefs: SidebarPrefs = { ...DEFAULT_PREFS };
  render(
    <ProjectSidebar
      projects={PROJECTS}
      sessions={PSESSIONS}
      currentProjectId="p1"
      activeSessionId="s1"
      onNewSession={h.cb()}
      onNewSessionIn={h.cb()}
      onOpenFolder={h.cb()}
      onSelectProject={h.cb()}
      onSelectSession={h.cb()}
      onProjectAction={h.cb()}
      onSessionAction={h.cb()}
      onReorder={h.cb()}
      onArchiveMany={h.cb()}
      onNavigate={h.cb()}
      now={NOW}
      prefs={{ load: () => prefs, save: (p) => void (prefs = p) }}
    />,
  );
}

/** 2번 이어하기 전 점검 카드 (파일이 바뀜) */
const FILES_ISSUE: ResumeIssueData = {
  check: 'files',
  title: '멈춘 뒤에 파일이 바뀌었어요',
  body: '멈춘 뒤에 파일 1개가 바뀌었어요. 어떻게 이어할까요?',
  list: ['a.ts (고쳐짐)'],
  choices: [
    { id: 'keep', label: '바뀐 걸 반영해서 계속', recommended: true, default: true },
    { id: 'revert', label: '멈춘 때로 되돌리고 계속' },
    { id: 'replan', label: '계획부터 다시' },
  ],
};

/** 5C 모델 버튼 (펼친 상태) */
function modelButton(h: Harness) {
  render(
    <ModelButton
      models={MODELS}
      current={{ engine: 'claude-code', model: 'sonnet' }}
      from="project"
      hasProject
      onChoose={h.cb()}
      onLogin={h.cb()}
    />,
  );
  fireEvent.click(screen.getByLabelText('AI: claude-code · sonnet (이 프로젝트 기본)'));
}

async function settingsScreen(h: Harness, tab: string) {
  lastSettings?.dispose();
  const m = memorySettings();
  lastSettings = m;
  m.store.setSecret('tools.braveKey', 'BSAabcdefghijklmnopqrstuv123456');
  const api = h.api(m.api);
  const extras = h.api({
    cleanup: async () => ({ ok: true as const, logs: 0, attachments: 0 }),
    about: async () => ({ version: '1.0.0', platform: 'linux', node: 'v22', updateCheck: false }),
    updateCheck: async () => ({ current: '1.0.0', message: '지금 최신 버전이에요.' }),
    diagnostics: async () => ({ file: 'harness-x-diagnostics.json', text: '{}' }),
    exportYaml: async () => ({ file: 'settings.yaml', text: '{}' }),
    importYaml: async () => ({ ok: true as const, imported: [] }),
  });
  const engineKeys = h.api({
    list: async () => [{ id: 'codex', label: 'Codex', masked: '••••9xyz' }],
    remove: async () => true,
  });
  render(
    <SettingsScreen
      api={api}
      initialTab={tab}
      storage={memStorage()}
      onBrowserChange={h.cb()}
      sections={{
        project: (
          <ProjectsSection projects={[PROJECTS[0]!, { ...PROJECTS[1]!, missing: true }]} onAction={h.cb()} />
        ),
        data: (
          <>
            <DataSection api={api} extras={extras} engineKeys={engineKeys} />
            <TransferSection extras={extras} download={h.cb()} />
          </>
        ),
        about: <AboutSection extras={extras} download={h.cb()} />,
      }}
    />,
  );
  await screen.findByRole('tablist', { name: '설정 묶음' });
  await waitFor(() => {
    // 탭의 설정을 다 불러올 때까지 (정보 탭은 레지스트리 항목이 없어 묶음 대신 덧붙임 화면만)
    if (document.body.textContent?.includes('설정을 불러오는 중')) throw new Error('설정 대기');
    if (!document.querySelector(`[data-setting-group="${tab}"], [data-settings-extra="${tab}"]`))
      throw new Error('설정 묶음 대기');
  });
  if (tab === 'data') await screen.findAllByRole('button', { name: '지우기' });
  if (tab === 'about') await screen.findByText('1.0.0');
}

export const RENDERERS: Record<string, Renderer> = {
  main: (h) => app(h, SESSION_EVENTS),

  'main-plus-menu': async (h) => {
    app(h, SESSION_EVENTS);
    await waitFor(() => {
      if (!screen.getByTestId('workspace').textContent?.includes(APP_WS.path))
        throw new Error('워크스페이스 대기');
    });
    fireEvent.click(screen.getByLabelText('추가'));
    fireEvent.click(screen.getByRole('menuitem', { name: /최근 프로젝트/ }));
    return { scope: '.hx-plus-menu' };
  },

  'main-narrow': (h) => {
    window.matchMedia = ((q: string) =>
      ({
        matches: /max-width/.test(q),
        media: q,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
      }) as unknown as MediaQueryList) as typeof window.matchMedia;
    app(h, SESSION_EVENTS);
    return { scope: '.hx-topbar' };
  },

  'empty-session': (h) => app(h, []),

  'chat-blocks': (h) => {
    const events = [...NINE_EVENTS, STOP_BLOCK_EVENT] as HarnessEvent[];
    render(
      <ChatStream
        events={events}
        mode="verbose"
        onModeChange={h.cb()}
        initialRect={{ width: 800, height: 4000 }}
      />,
    );
  },

  'composer-agent': async (h) => {
    render(
      <>
        <Composer
          engines={[
            { id: 'claude-code', label: 'Claude Code', available: true },
            { id: 'codex', label: 'Codex', available: true },
          ]}
          agents={AGENTS.agents as never}
          onSend={h.cb()}
          plusMenu={{ recent: [OLD_WS], onOpenFolder: h.cb(), onPickRecent: h.cb(), onTogglePin: h.cb() }}
        />
        <SubagentConfirm
          agent="/reviewer"
          running={{
            id: 's1',
            title: '로그인 화면',
            status: 'running',
            project: 'app',
            engineId: 'claude-code',
            updatedAt: TS,
          }}
          onAddSubagent={h.cb()}
          onNewSession={h.cb()}
          onCancel={h.cb()}
        />
      </>,
    );
    const input = screen.getByLabelText('지시 입력');
    fireEvent.change(input, { target: { value: '/reviewer 로그인 화면 봐 줘' } });
    fireEvent.keyDown(input, { key: 'Enter' }); // 칩으로 고정
    fireEvent.change(input, { target: { value: '로그인 화면 봐 줘' } });
  },

  'settings-engines': (h) => {
    const { api } = enginesApi();
    render(<EnginesSettings api={h.api(api)} />);
  },

  'install-installed': (h) => {
    render(<InstallManager api={installApi(h)} cards={sink(h)} initialTab="installed" />);
  },

  'install-search': async (h) => {
    render(<InstallManager api={installApi(h)} cards={sink(h)} initialTab="search" initialQuery="ffmpeg" />);
    await screen.findByText('이걸로 설치'); // 처음 검색어가 있으면 바로 찾는다
  },

  'install-url': async (h) => {
    render(<InstallManager api={installApi(h)} cards={sink(h)} initialTab="url" />);
    fireEvent.change(screen.getByLabelText('설치할 주소'), {
      target: { value: 'https://github.com/jqlang/jq' },
    });
    fireEvent.submit(screen.getByRole('button', { name: '확인' }).closest('form')!);
    await screen.findByText('이 방법으로 계획 보기');
  },

  'install-plan-card': (h) => {
    const [fr] = firstRunsFromEvents([firstRunEvent]);
    render(
      <>
        <InstallPlanCard
          plan={fixturePlan()}
          api={h.api({
            execute: async () => ({ jobId: 'j1', planId: 'plan_ffmpeg', status: 'running' }) as never,
          })}
          onAlternatives={h.cb()}
          onClose={h.cb()}
          openUrl={h.cb()}
        />
        <FirstRunCard data={fr!} answer={h.api({ a: async () => ({}) }).a} onDone={h.cb()} />
      </>,
    );
  },

  'tool-picker': (h) => {
    render(
      <ToolPickerCard
        data={pickerData()}
        onInstallSelected={h.cb()}
        onOpenUrlInstall={h.cb()}
        onContinueWithout={h.cb()}
      />,
    );
  },

  'approval-card': (h) =>
    app(h, [
      requestEvent(fixtureCard('path-1')),
      requestEvent(fixtureCard('text-1')),
      requestEvent(fixtureCard('number-1')),
    ]),

  checklist: (h) => {
    const approval = ev(1, {
      type: 'approval_request',
      itemId: '2',
      approvalId: 'ap-1',
      kind: 'ladder.l5',
      title: '경로 판정 확인',
      detail: {
        itemId: '2',
        artifactId: 'art.mobile-app',
        expectedPath: 'harness/mobile',
        actualPath: 'ai/mobile',
        reason: '이동으로 보임',
        buttons: [
          { id: 'equivalent', label: '동치 인정' },
          { id: 'move', label: '이동 승인' },
        ],
      },
      options: ['equivalent', 'move'],
    });
    render(
      <>
        <ChecklistPanel events={[approval]} api={h.api(checklistApi())} initialView={view()} />
        <ChecklistPanel
          events={[]}
          api={h.api(checklistApi())}
          initialView={view({ plan: { locked: false, revision: 0, artifacts: {} } })}
        />
      </>,
    );
  },

  'stop-controls': (h) => {
    render(
      <>
        <StopAllButton runningCount={2} onStopAll={h.cb()} />
        <StopButton onPause={h.cb()} onStopNow={h.cb()} />
      </>,
    );
    fireEvent.click(screen.getByLabelText('정지'));
  },

  'model-menu': (h) => modelButton(h),

  'model-menu-scope': (h) => {
    modelButton(h);
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Opus/ }));
    return { scope: '.hx-model-menu__scope' };
  },

  'engine-scan-empty': (h) => {
    render(
      <ScanBubble
        phase="empty"
        progress={scanDone({ found: 0, engines: [] })}
        onOpenInstall={h.cb()}
        onDismiss={h.cb()}
        reducedMotion
      />,
    );
  },

  'resume-cards': (h) => {
    render(
      <>
        <ProjectResumeCard
          now={new Date('2026-11-12T12:00:00.000Z')}
          sessions={[
            {
              sessionId: 's1',
              projectId: 'p1',
              title: '/design-qa 헤더',
              agent: { name: 'design-qa', command: '/design-qa', displayName: '디자인 검수', icon: '🎨' },
              engineId: 'codex',
              progress: 0.25,
              paused: { reason: 'user', at: '2026-11-12T09:00:00.000Z', by: 'user' },
              startedAt: null,
            },
          ]}
          onResume={h.cb()}
        />
        <ResumeCheckCard issue={FILES_ISSUE} onChoose={h.cb()} />
        <ResumeCountLink count={2} onOpen={h.cb()} />
      </>,
    );
  },

  'resume-flow': async (h) => {
    render(
      <ResumeFlow
        api={h.api({
          check: async () => ({ ok: false, issues: [FILES_ISSUE] }),
          start: async () => ({ mode: 'summary', version: 'pinned' }),
        })}
        sessionId="s1"
        onDone={h.cb()}
      />,
    );
    await screen.findByText('이 선택으로 이어하기');
    // 카드 안 선택지는 'resume-cards'에서 본다. 여기서는 흐름의 [이 선택으로 이어하기]
    return { scope: '.hx-resume-flow > .hx-resume-check__choices' };
  },

  recovery: (h) => {
    render(
      <ResumeCard
        card={{
          sessionId: 's9',
          engineId: 'claude-code',
          lastEventAt: TS,
          remaining: 3,
          nextItemId: '2',
          nextItemTitle: '항목 2 구현',
        }}
        onResume={h.api({ r: async () => ({}) }).r}
      />,
    );
  },

  'forge-cards': (h) => {
    const events = [
      forgeEvent(
        1,
        {
          questionId: 'kind',
          index: 1,
          total: 3,
          suggested: 'hook',
          choices: [
            { value: 'hook', label: '훅' },
            { value: 'skill', label: '스킬' },
          ],
        },
        ['hook', 'skill'],
      ),
      forgeEvent(
        2,
        {
          questionId: 'events',
          index: 2,
          total: 3,
          multiple: true,
          allowText: true,
          choices: [
            { value: 'a', label: '가' },
            { value: 'b', label: '나' },
          ],
        },
        ['a', 'b'],
      ),
      forgeEvent(3, { kind: 'forge_preview', summary: '미리 보기' }, ['저장', '취소']),
    ];
    render(
      <ForgeAnswerContext.Provider value={{ onAnswer: h.cb() }}>
        <ChatStream
          events={events}
          mode="verbose"
          onModeChange={h.cb()}
          initialRect={{ width: 800, height: 4000 }}
        />
      </ForgeAnswerContext.Provider>,
    );
  },

  'project-sidebar': (h) => projectSidebar(h),

  'project-sidebar-menus': (h) => {
    projectSidebar(h);
    fireEvent.click(screen.getByLabelText('프로젝트 골라서 새 세션'));
    fireEvent.click(screen.getByLabelText('imjang-note 메뉴'));
    fireEvent.click(screen.getByLabelText('design-qa 메뉴'));
  },

  'project-picker': (h) => {
    render(
      <>
        <WhereToWork
          recent={PROJECTS}
          onOpenFolder={h.cb()}
          onPickProject={h.cb()}
          onScratch={h.cb()}
          onCancel={h.cb()}
        />
        <RootSuggestCard
          s={{
            path: '/mnt/c/work/app/src',
            gitRoot: '/mnt/c/work/app',
            suggest: true,
            message: '맨 위 폴더가 있어요',
          }}
          onUseTop={h.cb()}
          onKeep={h.cb()}
        />
      </>,
    );
  },

  'empty-session-projects': (h) => {
    render(
      <>
        <EmptySession
          projectName="imjang-note"
          recentAgents={[{ command: '/design-qa', name: 'design-qa', icon: '🎨' }]}
          onExample={h.cb()}
          onAgent={h.cb()}
        />
        <ConfirmCard
          title="목록에서 뺄까요?"
          body="파일은 지우지 않아요."
          confirmLabel="빼기"
          onConfirm={h.cb()}
          onCancel={h.cb()}
        />
        <ProjectSettings
          project={PROJECTS[0]!}
          info={{ hasAgentsMd: true, hasClaudeMd: false, git: true, branch: 'main' }}
          engines={[{ id: 'claude-code', label: 'Claude Code', available: true }]}
          agents={[{ command: '/design-qa', name: 'design-qa' }]}
          onSave={h.cb()}
          onRelink={h.cb()}
          onClose={h.cb()}
        />
      </>,
    );
  },

  'settings-form': async (h) => {
    lastSettings?.dispose(); // 임시 폴더 정리 (화면을 다시 그릴 때마다 새로 만든다)
    const m = memorySettings();
    lastSettings = m;
    render(
      <SettingsForm
        api={h.api(m.api)}
        showAdvanced
        storage={memStorage()}
        ctx={{ pickFolder: h.api({ f: async () => ({ cancelled: true }) }).f as never }}
      />,
    );
    await screen.findByText('모든 설정 기본값으로');
  },

  // T-101 6번 설정 화면 (13개 탭·고급 설정 보기 + 프로젝트·데이터·정보 덧붙임 화면)
  'settings-sections': (h) => settingsScreen(h, 'general'),
  'settings-sections-project': (h) => settingsScreen(h, 'project'),
  'settings-sections-data': (h) => settingsScreen(h, 'data'),
  'settings-sections-about': (h) => settingsScreen(h, 'about'),

  'builder-start': (h) => builder(h),

  'builder-blocks': (h) => {
    builder(h);
    fireEvent.click(screen.getByText('빈 캔버스'));
    const canvas = document.querySelector('.hx-canvas') as HTMLElement;
    fireEvent.drop(canvas, { dataTransfer: blockTransfer('node', 'role'), clientX: 50, clientY: 50 });
    fireEvent.drop(canvas, { dataTransfer: blockTransfer('node', 'verifier'), clientX: 250, clientY: 50 });
    fireEvent.drop(canvas, { dataTransfer: blockTransfer('skill', 'code-review'), clientX: 50, clientY: 50 });
    fireEvent.drop(canvas, { dataTransfer: blockTransfer('skill', 'refactor'), clientX: 50, clientY: 50 });
  },

  'builder-chat': async (h) => {
    const api = fakeDesignerApi({
      design: [
        { kind: 'questions', questions: QUESTIONS } as never,
        {
          kind: 'draft',
          draftId: '',
          version: 1,
          draft: sampleDraft(),
          notices: [],
          engineSuggestions: [],
        } as never,
      ],
    });
    builder(h, { catalog: DRAFT_CATALOG, designerApi: h.api(api), onFindTool: h.cb(), onForge: h.cb() });
    fireEvent.click(screen.getByText('말이나 글로 설명해서 만들기'));
    const input = screen.getByLabelText('설명 입력') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: '화면을 검수하는 에이전트 만들어 줘' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await new Promise((r) => setTimeout(r, 50));
  },
};
