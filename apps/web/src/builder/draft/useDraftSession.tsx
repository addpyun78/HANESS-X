import {
  AgentDraftSchema,
  changedMarks,
  type AgentDraft,
  type DraftChange,
  type DraftGap,
} from '@harness-x/protocol';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { BuilderCatalog } from '../catalog.js';
import { BUILDER_CHAT_WELCOME, type ChatMessage } from '../chat/BuilderChat.js';
import type { BuilderGraph } from '../graph.js';
import type { DesignerApi, DraftListItem, DraftRecordInfo, EngineSuggestion } from './api.js';
import { NO_DECOR, type DraftDecor } from './decor.js';
import { PatchPreview, QuestionCard, SummaryCard, type GapActions } from './DraftCards.js';
import { handOffToForge } from './forge-handoff.js';
import {
  draftChecklist,
  draftToGraph,
  graphToDraft,
  patchConflicts,
  touchedBy,
  type TouchKey,
} from './model.js';

/**
 * 대화로 만들기 상태 (BuilderPage가 쓴다)
 *   C.3 질문 카드 → 답/알아서 해 줘 → C.4 초안 → 캔버스 조립(D.2 0.2초 간격) + 요약 카드(D.3)
 *   E.2~E.5 말로 고치기 → 바뀐 점 미리보기(노란색) → [적용]/[취소], 직접 고친 칸 충돌 확인
 *   E.6 버전(적용마다 v+1, 되돌리기), E.7 적용 = 실행 취소 한 단계, E.8 YAML 적용 = 새 버전
 *   F.9 캔버스 직접 수정은 자동 보관(working), 다음에 "이어서 할까요?"
 */

export const ANIMATION_STEP_MS = 200;
export const ANIMATION_SETTING_KEY = 'hx.builder.animation';

export function animationEnabled(): boolean {
  try {
    return localStorage.getItem(ANIMATION_SETTING_KEY) !== 'off';
  } catch {
    return true;
  }
}

type Dispatch = (a: { type: string } & Record<string, unknown>) => void;

export interface DraftSessionOptions {
  api: DesignerApi | undefined;
  graph: BuilderGraph;
  dispatch: Dispatch;
  catalog: BuilderCatalog;
  /** 초안 이름·명령이 정해지면 저장 줄에 반영 */
  onMeta: (m: { name: string; displayName: string; command: string }) => void;
  animate: boolean;
  /** P4-C.10 [도구 찾기] — Part 3 D.3이 연결 */
  onFindTool?: (gap: DraftGap) => void;
  /** P4-C.11 [Forge로 만들기] (기본: Forge 입력창에 채우고 이동) */
  onForge?: (gap: DraftGap) => void;
  autosaveMs?: number;
}

interface Session {
  id: string;
  request: string;
  /** 마지막 버전 (reason·duty·gaps의 기준) */
  base: AgentDraft;
  record: DraftRecordInfo | undefined;
  version: number;
  suggestions: EngineSuggestion[];
}

interface Preview {
  draft: AgentDraft;
  changes: DraftChange[];
  conflicts: DraftChange[];
}

let seq = 0;
const mid = () => `d${++seq}`;

export function useDraftSession(o: DraftSessionOptions) {
  const { api, graph, dispatch } = o;
  const [messages, setMessages] = useState<ChatMessage[]>([BUILDER_CHAT_WELCOME]);
  const [busy, setBusy] = useState(false);
  const [extra, setExtra] = useState<ReactNode>();
  const [session, setSession] = useState<Session>();
  const [preview, setPreview] = useState<Preview>();
  const [revealed, setRevealed] = useState(Infinity);
  const [resume, setResume] = useState<DraftListItem>();
  const [drafts, setDrafts] = useState<DraftListItem[]>([]);
  const touched = useRef(new Set<TouchKey>());
  const pendingVersion = useRef<'yaml' | undefined>(undefined);
  const lastSaved = useRef<string>('');

  const say = useCallback(
    (role: ChatMessage['role'], text: string, card?: ReactNode) =>
      setMessages((ms) => [...ms, { id: mid(), role, text, ...(card ? { card } : {}) }]),
    [],
  );

  const current = useMemo(() => (session ? graphToDraft(graph, session.base) : undefined), [graph, session]);

  // F.9/F.10 처음 열 때 만들던 초안 확인
  const refreshDrafts = useCallback(() => {
    if (!api) return;
    api
      .listDrafts()
      .then((xs) => {
        setDrafts(xs);
        return xs;
      })
      .then((xs) => setResume((r) => r ?? xs[0]))
      .catch(() => undefined);
  }, [api]);
  useEffect(refreshDrafts, [refreshDrafts]);

  /** 초안을 캔버스에 올린다 (first = 첫 초안이면 조립 애니메이션) */
  const showDraft = useCallback(
    (d: AgentDraft, how: 'load' | 'replace') => {
      dispatch({ type: how, graph: draftToGraph(d, how === 'replace' ? graph : undefined) });
      o.onMeta({ name: d.name, displayName: d.displayName, command: d.command });
      if (how === 'load' && o.animate) setRevealed(0);
      else setRevealed(Infinity);
    },
    [dispatch, graph, o],
  );

  // D.2 조립 애니메이션: 0.2초마다 노드 하나씩
  useEffect(() => {
    if (!session || revealed >= session.base.nodes.length) return;
    const t = setTimeout(() => setRevealed((r) => r + 1), ANIMATION_STEP_MS);
    return () => clearTimeout(t);
  }, [revealed, session]);

  const adopt = useCallback(
    (rec: DraftRecordInfo, how: 'load' | 'replace', suggestions: EngineSuggestion[] = []) => {
      const last = rec.versions.at(-1)!;
      const d = rec.working ?? last.draft;
      setSession({ id: rec.id, request: rec.request, base: d, record: rec, version: last.v, suggestions });
      lastSaved.current = JSON.stringify(d);
      showDraft(d, how);
      return d;
    },
    [showDraft],
  );

  // ── 요청 보내기 ────────────────────────────────────────────
  const design = useCallback(
    async (
      request: string,
      extraOpts: { skipQuestions?: boolean; answers?: { question: string; answer: string }[] } = {},
    ) => {
      if (!api) return say('ai', '하네스 서버에 연결되지 않아서 초안을 만들 수 없어요.');
      setBusy(true);
      setExtra(undefined);
      try {
        const r = await api.design({ request, ...extraOpts });
        if (r.kind === 'questions') {
          say('ai', '조금만 더 알려 주세요.');
          setExtra(
            <QuestionCard
              questions={r.questions}
              onAnswer={(answers) => void design(request, { answers })}
              onSkip={() => void design(request, { skipQuestions: true })}
            />,
          );
          return;
        }
        if (r.kind === 'failed') return say('ai', r.message);
        const rec = await api.getDraft(r.draftId).catch(() => undefined);
        const record: DraftRecordInfo = rec ?? {
          id: r.draftId,
          request,
          createdAt: '',
          updatedAt: '',
          conversation: [],
          versions: [{ v: r.version, at: '', source: 'ai', draft: r.draft }],
        };
        touched.current.clear();
        adopt(record, 'load', r.engineSuggestions);
        setSession((s) => s && { ...s, suggestions: r.engineSuggestions });
        say(
          'ai',
          [
            '이렇게 만들어 봤어요.',
            ...r.notices.map((n) => n.message),
            ...(r.draft.gaps.length ? [`빈 칸이 ${r.draft.gaps.length}개 있어요.`] : []),
          ].join('\n'),
          <SummaryCard draft={r.draft} suggestions={r.engineSuggestions} />,
        );
      } catch {
        say('ai', '초안을 만들지 못했어요. 잠시 뒤 다시 보내 주세요.');
      } finally {
        setBusy(false);
      }
    },
    [api, adopt, say],
  );

  const edit = useCallback(
    async (instruction: string) => {
      if (!api || !session || !current) return;
      setBusy(true);
      try {
        const r = await api.edit({ draft: current, instruction });
        if (!r.ok) return say('ai', [r.message, ...r.reasons].join('\n'));
        const conflicts = patchConflicts(r.changes, touched.current);
        setPreview({ draft: r.draft, changes: r.changes, conflicts });
        say('ai', r.changes.length ? '이렇게 바꿔 볼게요. 확인해 주세요.' : '바뀌는 곳이 없어요.');
      } catch {
        say('ai', '고치지 못했어요. 잠시 뒤 다시 보내 주세요.');
      } finally {
        setBusy(false);
      }
    },
    [api, session, current, say],
  );

  const onSend = useCallback(
    (text: string) => {
      say('user', text);
      setPreview(undefined);
      if (session) void edit(text);
      else void design(text);
    },
    [session, edit, design, say],
  );

  // ── E.4 적용·취소 / E.6 버전 ────────────────────────────────
  const putVersion = useCallback(
    async (d: AgentDraft, source: 'ai-patch' | 'yaml' | 'canvas', note?: string) => {
      if (!api || !session) return;
      const rec = await api.putDraft(session.id, {
        draft: d,
        version: true,
        source,
        ...(note ? { note } : {}),
      });
      lastSaved.current = JSON.stringify(d);
      setSession((s) => s && { ...s, base: d, record: rec, version: rec.versions.at(-1)!.v });
    },
    [api, session],
  );

  const apply = useCallback(() => {
    if (!preview || !session) return;
    // E.7 AI 패치 한 건 = 실행 취소 한 단계 ('replace'는 기록된다)
    dispatch({ type: 'replace', graph: draftToGraph(preview.draft, graph) });
    setSession((s) => s && { ...s, base: preview.draft });
    for (const c of preview.conflicts) touched.current.delete(`${c.nodeId}/${c.field}`);
    void putVersion(preview.draft, 'ai-patch', preview.changes[0]?.message);
    setPreview(undefined);
    say('ai', '바꿨어요.');
  }, [preview, session, dispatch, graph, putVersion, say]);

  const cancel = useCallback(() => {
    setPreview(undefined);
    say('ai', '바꾸지 않았어요.');
  }, [say]);

  const revert = useCallback(
    async (v: number) => {
      if (!api || !session) return;
      const rec = await api.revertDraft(session.id, v);
      const d = rec.versions.at(-1)!.draft;
      dispatch({ type: 'replace', graph: draftToGraph(d, graph) });
      lastSaved.current = JSON.stringify(d);
      setSession((s) => s && { ...s, base: d, record: rec, version: rec.versions.at(-1)!.v });
      say('ai', `v${v}로 되돌렸어요.`);
    },
    [api, session, dispatch, graph, say],
  );

  const resumeDraft = useCallback(
    async (id: string) => {
      if (!api) return;
      const rec = await api.getDraft(id);
      setResume(undefined);
      touched.current.clear();
      const d = adopt(rec, 'load');
      setMessages([
        BUILDER_CHAT_WELCOME,
        ...rec.conversation.map((c) => ({ id: mid(), role: c.role, text: c.text })),
        {
          id: mid(),
          role: 'ai' as const,
          text: '만들던 초안을 다시 열었어요.',
          card: <SummaryCard draft={d} />,
        },
      ]);
    },
    [api, adopt],
  );

  const deleteDraft = useCallback(
    async (id: string) => {
      if (!api) return;
      await api.deleteDraft(id);
      setDrafts((xs) => xs.filter((x) => x.id !== id));
      setResume((r) => (r?.id === id ? undefined : r));
    },
    [api],
  );

  // ── 사람 수정 추적 (E.5) · YAML 적용 → 새 버전 (E.8) ────────
  const track: Dispatch = useCallback(
    (a) => {
      if (session) {
        for (const k of touchedBy(a)) touched.current.add(k);
        if (a.type === 'loadYaml') pendingVersion.current = 'yaml';
      }
      dispatch(a);
    },
    [dispatch, session],
  );

  useEffect(() => {
    if (!session || !current) return;
    const text = JSON.stringify(current);
    if (pendingVersion.current === 'yaml') {
      pendingVersion.current = undefined;
      if (text !== lastSaved.current) void putVersion(current, 'yaml', '설정 글에서 고쳤어요.');
      return;
    }
    if (text === lastSaved.current || !api) return;
    // F.9 캔버스 직접 수정은 자동 보관만 (버전은 늘리지 않는다)
    const t = setTimeout(() => {
      lastSaved.current = text;
      void api.putDraft(session.id, { draft: current }).catch(() => undefined);
    }, o.autosaveMs ?? 500);
    return () => clearTimeout(t);
  }, [current, session, api, putVersion, o.autosaveMs]);

  // ── 화면 조각 ──────────────────────────────────────────────
  const decor: DraftDecor = useMemo(() => {
    if (!session) return NO_DECOR;
    const marks = preview
      ? changedMarks(preview.changes)
      : { nodes: new Set<string>(), chips: new Set<string>() };
    if (preview)
      for (const c of preview.changes)
        if (c.field === 'engine' && c.nodeId) marks.chips.add(`${c.nodeId}:@engine`);
    const hidden = new Set(
      session.base.nodes.slice(Number.isFinite(revealed) ? revealed : Infinity).map((n) => n.id),
    );
    return { draft: true, changed: marks.nodes, chips: marks.chips, hidden };
  }, [session, preview, revealed]);

  const previewGraph = useMemo(
    () => (preview ? draftToGraph(preview.draft, graph) : undefined),
    [preview, graph],
  );

  const gapActions: GapActions = {
    onFindTool: (g) => o.onFindTool?.(g),
    onForge: (g) => (o.onForge ?? handOffToForge)(g),
    onRemove: (g) => {
      if (!session) return;
      const d = { ...(current ?? session.base), gaps: session.base.gaps.filter((x) => x.id !== g.id) };
      setSession((s) => s && { ...s, base: { ...s.base, gaps: s.base.gaps.filter((x) => x.id !== g.id) } });
      void putVersion(d, 'canvas', '빈 칸 하나를 뺐어요.');
    },
  };

  const checklist = useMemo(() => {
    if (!current || !session) return [];
    const engineHealth: Record<string, string> = {};
    for (const s of session.suggestions) engineHealth[s.engine] = s.health;
    return draftChecklist(current, {
      engineHealth,
      knownSkills: new Set([
        ...o.catalog.skills.map((s) => s.id),
        ...session.base.nodes.flatMap((n) => n.skills),
      ]),
      knownTools: new Set([
        ...o.catalog.tools.map((t) => t.id),
        ...session.base.nodes.flatMap((n) => n.tools),
      ]),
      schemaOk: AgentDraftSchema.safeParse(current).success,
    });
  }, [current, session, o.catalog]);

  const reasons = useMemo(
    () => Object.fromEntries((current?.nodes ?? []).map((n) => [n.id, n.reason])),
    [current],
  );

  const chatExtra =
    preview !== undefined ? (
      <PatchPreview
        changes={preview.changes}
        conflicts={preview.conflicts}
        onApply={apply}
        onCancel={cancel}
      />
    ) : (
      extra
    );

  return {
    session,
    current,
    chat: { messages, busy, extra: chatExtra, onSend },
    decor,
    /** 미리보기 중이면 바뀐 모습을 캔버스에 보여 준다 (적용 전) */
    canvasGraph: previewGraph ?? graph,
    previewing: !!preview,
    gaps: current?.gaps ?? [],
    gapActions,
    checklist,
    reasons,
    revert,
    track,
    resume,
    resumeDraft,
    dismissResume: () => setResume(undefined),
    drafts,
    refreshDrafts,
    deleteDraft,
    markSaved: () => {
      setResume(undefined);
    },
  };
}
