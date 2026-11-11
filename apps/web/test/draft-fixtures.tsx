import {
  AgentDraftSchema,
  diffDrafts,
  type AgentDraft,
  type AgentDraftInput,
  type DraftQuestion,
} from '@harness-x/protocol';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, vi } from 'vitest';
import { BuilderPage, type BuilderPageProps } from '../src/builder/BuilderPage.js';
import type { BuilderCatalog } from '../src/builder/catalog.js';
import type {
  DesignerApi,
  DesignResponse,
  DraftRecordInfo,
  EditResponse,
  EngineSuggestion,
} from '../src/builder/draft/api.js';

/** 대화로 만들기 웹 테스트용: 화면 예시(컨셉 E) 초안 */
export function sampleDraftInput(): AgentDraftInput {
  return {
    name: 'design-review',
    displayName: '화면 디자인 검수',
    command: '/design-review',
    summary: [
      '임장노트 화면 디자인을 살펴보고 고쳐요.',
      '먼저 계획을 세우고 codex가 화면을 고쳐요.',
      '마지막으로 다른 AI가 결과를 한 번 더 검사해요.',
    ].join('\n'),
    nodes: [
      {
        id: 'plan',
        kind: 'role',
        role: '계획 담당',
        duty: 'plan',
        engine: 'claude-code',
        skills: ['plan-writer'],
        reason: '계획은 글을 잘 정리하는 AI에게 맡겼어요.',
      },
      {
        id: 'build',
        kind: 'role',
        role: '고치기 담당',
        duty: 'write',
        engine: 'codex',
        skills: ['kotlin-compose', 'ui-tokens'],
        permission: 'workspace-write',
        reason: '말씀하신 대로 고치는 일은 codex에게 맡겼어요.',
      },
      {
        id: 'critic',
        kind: 'role',
        role: '검사 담당',
        duty: 'check',
        engine: 'antigravity',
        skills: ['ui-audit'],
        reason: '고친 AI와 다른 AI가 검사해야 더 객관적이에요.',
      },
    ],
    edges: [
      { from: 'plan', to: 'build' },
      { from: 'build', to: 'critic' },
    ],
    gaps: [{ id: 'gap-1', need: '화면 스크린샷 두 장을 비교하는 기능', nodeId: 'critic', kind: 'skill' }],
    estimatedCostHint: '구독 범위 안에서 한 번에 10분 정도 걸려요.',
  };
}

export const sampleDraft = (over: Partial<AgentDraftInput> = {}): AgentDraft =>
  AgentDraftSchema.parse({ ...sampleDraftInput(), ...over });

export const DRAFT_CATALOG: BuilderCatalog = {
  plugins: [],
  agents: [],
  skills: ['plan-writer', 'kotlin-compose', 'ui-tokens', 'ui-audit', 'compose-ui'].map((id) => ({
    id,
    label: id,
  })),
  engines: ['claude-code', 'codex', 'antigravity'].map((id) => ({ id, label: id })),
  tools: [{ id: 'screenshot', label: 'screenshot' }],
};

/** 메모리 초안 저장소 + 정해 둔 설계 응답 */
export function fakeDesignerApi(
  o: {
    design?: DesignResponse[];
    edit?: (draft: AgentDraft, instruction: string) => EditResponse;
    suggestions?: EngineSuggestion[];
    drafts?: DraftRecordInfo[];
  } = {},
) {
  const store = new Map<string, DraftRecordInfo>((o.drafts ?? []).map((d) => [d.id, structuredClone(d)]));
  const designQueue = [...(o.design ?? [])];
  let n = 0;
  const now = () => new Date(Date.UTC(2026, 10, 11, 0, 0, n++)).toISOString();
  const designCalls: Parameters<DesignerApi['design']>[0][] = [];
  const api: DesignerApi & { store: typeof store; designCalls: typeof designCalls } = {
    store,
    designCalls,
    design: vi.fn(async (req) => {
      designCalls.push(req);
      const next = designQueue.length > 1 ? designQueue.shift()! : designQueue[0];
      const r = next ?? {
        kind: 'draft',
        draftId: '',
        version: 1,
        draft: sampleDraft(),
        notices: [],
        engineSuggestions: [],
      };
      if (r.kind !== 'draft') return r;
      const id = `draft-${store.size + 1}`;
      store.set(id, {
        id,
        request: req.request,
        createdAt: now(),
        updatedAt: now(),
        conversation: [{ role: 'user', text: req.request }],
        versions: [{ v: 1, at: now(), source: 'ai', draft: r.draft }],
      });
      return { ...r, draftId: id, engineSuggestions: o.suggestions ?? r.engineSuggestions };
    }),
    edit: vi.fn(async ({ draft, instruction }) =>
      o.edit ? o.edit(draft, instruction) : { ok: false as const, message: '모르겠어요.', reasons: [] },
    ),
    listDrafts: vi.fn(async () =>
      [...store.values()].map((r) => {
        const d = r.working ?? r.versions.at(-1)!.draft;
        return {
          id: r.id,
          displayName: d.displayName,
          request: r.request,
          updatedAt: r.updatedAt,
          versions: r.versions.length,
          gaps: d.gaps.length,
          stale: Date.parse('2026-11-11T00:00:00Z') - Date.parse(r.updatedAt) > 30 * 86400000,
        };
      }),
    ),
    getDraft: vi.fn(async (id) => structuredClone(store.get(id)!)),
    putDraft: vi.fn(async (id, body) => {
      const r = store.get(id)!;
      if (body.version) {
        const { working: _w, ...rest } = r;
        const next: DraftRecordInfo = {
          ...rest,
          updatedAt: now(),
          versions: [
            ...r.versions,
            {
              v: r.versions.at(-1)!.v + 1,
              at: now(),
              source: body.source ?? 'canvas',
              ...(body.note ? { note: body.note } : {}),
              draft: body.draft,
            },
          ],
        };
        store.set(id, next);
      } else store.set(id, { ...r, working: body.draft, updatedAt: now() });
      return structuredClone(store.get(id)!);
    }),
    revertDraft: vi.fn(async (id, v) => {
      const r = store.get(id)!;
      const old = r.versions.find((x) => x.v === v)!;
      const next: DraftRecordInfo = {
        ...r,
        versions: [
          ...r.versions,
          { v: r.versions.at(-1)!.v + 1, at: now(), source: 'revert', draft: old.draft },
        ],
      };
      store.set(id, next);
      return structuredClone(next);
    }),
    deleteDraft: vi.fn(async (id) => {
      store.delete(id);
    }),
    gestureToken: vi.fn(async () => 'gesture-1'),
    saveAgent: vi.fn(async (body) => ({
      name: body.draft.name,
      command: body.draft.command,
      dir: `/home/u/.harness-x/agents/${body.draft.name}`,
      files: [],
      status: body.draft.gaps.length ? ('incomplete' as const) : ('ready' as const),
    })),
  };
  return api;
}

/** 초안 → "검사는 claude로" 패치 결과 */
export function criticToClaude(draft: AgentDraft): EditResponse {
  const next = structuredClone(draft);
  next.nodes.find((x) => x.id === 'critic')!.engine = 'claude-code';
  return { ok: true, draft: next, changes: diffDrafts(draft, next), patch: [] };
}

export const QUESTIONS: DraftQuestion[] = [
  { id: 'q1', text: '어떤 일을 도와 드릴까요?', choices: ['화면 고치기', '코드 검사'] },
  { id: 'q2', text: '파일을 직접 고쳐도 되나요?', choices: ['고쳐도 돼요', '읽기만 해요'] },
];

/** 빌더를 "말이나 글로 설명해서 만들기"로 시작하고 요청을 보낸다 */
export async function startChatAndSend(
  api: DesignerApi,
  text = '임장노트 화면 디자인을 검수해 주는 에이전트 만들어 줘',
  props: Partial<BuilderPageProps> = {},
) {
  const r = render(
    <BuilderPage
      route="/builder/new"
      catalog={DRAFT_CATALOG}
      designerApi={api}
      animate={false}
      autosaveMs={0}
      loadStt={() => Promise.resolve(undefined)}
      {...props}
    />,
  );
  fireEvent.click(screen.getByText('말이나 글로 설명해서 만들기'));
  if (text) await sendChat(text);
  return r;
}

export async function sendChat(text: string) {
  const input = screen.getByLabelText('설명 입력') as HTMLTextAreaElement;
  fireEvent.change(input, { target: { value: text } });
  fireEvent.keyDown(input, { key: 'Enter' });
  await vi.waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeNull());
}
