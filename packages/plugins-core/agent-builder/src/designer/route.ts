import { userInfo } from 'node:os';
import { gestureTokenFrom, type HumanGestureTokens } from '@harness-x/kernel';
import { AgentDraftSchema } from '@harness-x/protocol';
import { DraftStore, VERSION_SOURCES, type VersionSource } from '../drafts/store.js';
import { saveDraftAgent } from '../drafts/save.js';
import type { Inventory } from '../inventory/schema.js';
import { Designer } from './designer.js';
import type { DesignerAsk } from './session.js';
import type { BuilderSettings } from './settings.js';

/**
 * 대화로 만들기 API (커널 cli.ts가 agent-builder 모듈을 구조적으로 불러 등록한다)
 *   POST /api/builder/design      {request, skipQuestions?, answers?} → 질문 | 초안(초안 저장소에 v1)
 *   POST /api/builder/edit        {draft, instruction} → 검사된 패치 미리보기 (적용 안 함)
 *   GET  /api/builder/drafts      초안 목록 (30일 지난 것 stale)
 *   GET/PUT/DELETE /api/builder/drafts/:id, POST /api/builder/drafts/:id/revert {version}
 *   POST /api/agents/save         {draftId, draft, allowIncomplete?} + 사람 클릭 토큰(save-agent) — 없으면 403
 * P4-F.1 설계 AI에게는 어떤 도구도 주지 않는다(세션이 도구 없이 돈다). 저장은 이 라우트뿐이고 클릭 토큰이 필요하다.
 */

type Req = { body?: unknown; params?: unknown; headers: Record<string, unknown> };
type Reply = { code(n: number): { send(b: unknown): unknown } };
type Handler = (req: Req, reply: Reply) => Promise<unknown>;

export interface DesignerRouteHost {
  get(path: string, h: Handler): unknown;
  post(path: string, h: Handler): unknown;
  put(path: string, h: Handler): unknown;
  delete(path: string, h: Handler): unknown;
}

export interface BuilderDesignerOptions {
  home: string;
  inventory: () => Promise<Inventory>;
  /** 설계 세션 (builder.engine → 세션 기본 엔진). 없으면 503 */
  session: () =>
    | { ask: DesignerAsk; engineId: string }
    | undefined
    | Promise<{ ask: DesignerAsk; engineId: string } | undefined>;
  settings?: () => Partial<BuilderSettings>;
  /** 사람 클릭 토큰 저장소 (커널 서버와 공유) */
  gestures: Pick<HumanGestureTokens, 'consume'>;
  /** 이미 등록된 에이전트 (이름·명령 중복 검사) */
  agents: () => readonly { name: string; command: string }[];
  /** 저장 뒤 알림 (레지스트리는 요청마다 다시 읽으므로 / 목록에 바로 나타난다) */
  onSaved?: (s: { name: string; command: string; dir: string }) => void;
  savedBy?: () => string;
  now?: () => Date;
}

export const DESIGN_ROUTE = '/api/builder/design';
export const EDIT_ROUTE = '/api/builder/edit';
export const DRAFTS_ROUTE = '/api/builder/drafts';
export const SAVE_AGENT_ROUTE = '/api/agents/save';

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' ? (v as Record<string, unknown>) : {};

export function registerBuilderDesigner(app: DesignerRouteHost, o: BuilderDesignerOptions): DraftStore {
  const drafts = new DraftStore({ home: o.home, ...(o.now ? { now: o.now } : {}) });
  const designer = async () => {
    const s = await o.session();
    return s
      ? {
          d: new Designer({ ask: s.ask, inventory: o.inventory, settings: o.settings?.() ?? {} }),
          engineId: s.engineId,
        }
      : undefined;
  };
  const noEngine = (reply: Reply) =>
    reply
      .code(503)
      .send({ error: 'no_engine', message: '설계에 쓸 AI가 없어요. 설정에서 AI를 골라 주세요.' });

  app.post(DESIGN_ROUTE, async (req, reply) => {
    const b = obj(req.body);
    if (typeof b.request !== 'string' || !b.request.trim())
      return reply
        .code(400)
        .send({ error: 'invalid_request', message: '만들고 싶은 에이전트를 적어 주세요.' });
    const x = await designer();
    if (!x) return noEngine(reply);
    const answers = Array.isArray(b.answers)
      ? (b.answers as { question: string; answer: string }[]).filter(
          (a) => typeof a?.question === 'string' && typeof a?.answer === 'string',
        )
      : undefined;
    const r = await x.d.design(b.request, {
      ...(b.skipQuestions === true ? { skipQuestions: true } : {}),
      ...(answers?.length ? { answers } : {}),
    });
    if (r.kind !== 'draft') return r;
    const rec = drafts.create({
      request: b.request,
      draft: r.draft,
      designEngine: x.engineId,
      conversation: [
        { role: 'user', text: b.request },
        ...(answers ?? []).map((a) => ({ role: 'user' as const, text: `${a.question} → ${a.answer}` })),
        { role: 'ai', text: r.draft.summary },
      ],
    });
    return {
      kind: 'draft',
      draftId: rec.id,
      version: 1,
      draft: r.draft,
      notices: r.notices,
      engineSuggestions: r.engineSuggestions,
      designEngine: x.engineId,
    };
  });

  app.post(EDIT_ROUTE, async (req, reply) => {
    const b = obj(req.body);
    const d = AgentDraftSchema.safeParse(b.draft);
    if (!d.success || typeof b.instruction !== 'string' || !b.instruction.trim())
      return reply.code(400).send({ error: 'invalid_request', message: '고칠 초안과 말이 필요해요.' });
    const x = await designer();
    if (!x) return noEngine(reply);
    return x.d.edit(d.data, b.instruction);
  });

  app.get(DRAFTS_ROUTE, async () => ({ drafts: drafts.list() }));

  const draftId = (req: Req) => String(obj(req.params).id ?? '');
  const notFound = (reply: Reply) =>
    reply.code(404).send({ error: 'not_found', message: '초안을 찾지 못했어요.' });
  const safe = <T>(f: () => T): T | undefined => {
    try {
      return f();
    } catch {
      return undefined;
    }
  };

  app.get(
    `${DRAFTS_ROUTE}/:id`,
    async (req, reply) => safe(() => drafts.get(draftId(req))) ?? notFound(reply),
  );

  app.put(`${DRAFTS_ROUTE}/:id`, async (req, reply) => {
    const id = draftId(req);
    const b = obj(req.body);
    const d = AgentDraftSchema.safeParse(b.draft);
    if (!d.success)
      return reply.code(400).send({ error: 'invalid_draft', message: '초안 모양이 알맞지 않아요.' });
    if (!safe(() => drafts.get(id))) return notFound(reply);
    const source: VersionSource = (VERSION_SOURCES as readonly string[]).includes(String(b.source))
      ? (b.source as VersionSource)
      : 'canvas';
    if (Array.isArray(b.conversation))
      drafts.appendConversation(
        id,
        (b.conversation as { role: 'user' | 'ai'; text: string }[]).filter(
          (c) => (c?.role === 'user' || c?.role === 'ai') && typeof c.text === 'string',
        ),
      );
    return b.version === true
      ? drafts.addVersion(id, d.data, source, typeof b.note === 'string' ? b.note : undefined)
      : drafts.saveWorking(id, d.data);
  });

  app.post(`${DRAFTS_ROUTE}/:id/revert`, async (req, reply) => {
    const v = Number(obj(req.body).version);
    return safe(() => drafts.revert(draftId(req), v)) ?? notFound(reply);
  });

  // 사용자가 [삭제]를 눌렀을 때만 (오래된 초안도 자동으로 지우지 않는다)
  app.delete(`${DRAFTS_ROUTE}/:id`, async (req, reply) =>
    safe(() => drafts.remove(draftId(req))) ? { ok: true } : notFound(reply),
  );

  // P4-F.2 저장: 사람 클릭 토큰(save-agent, 1회용 60초) 필수
  app.post(SAVE_AGENT_ROUTE, async (req, reply) => {
    const g = o.gestures.consume(gestureTokenFrom(req.headers, req.body), 'save-agent');
    if (!g.ok)
      return reply.code(403).send({ error: 'gesture_required', reason: g.reason, message: g.message });
    const b = obj(req.body);
    const record = typeof b.draftId === 'string' ? safe(() => drafts.get(b.draftId as string)) : undefined;
    const agents = o.agents();
    const r = saveDraftAgent({
      home: o.home,
      draft: b.draft as never,
      ...(record ? { record } : {}),
      allowIncomplete: b.allowIncomplete === true,
      taken: { names: agents.map((a) => a.name), commands: agents.map((a) => a.command) },
      savedBy: o.savedBy?.() ?? safeUser(),
      gestureId: g.id,
      ...(o.now ? { now: o.now } : {}),
    });
    if (!r.ok) {
      const { ok: _ok, status, ...body } = r;
      return reply.code(status).send(body);
    }
    if (record) drafts.remove(record.id); // 저장된 초안은 "만들던 초안" 목록에서 뺀다
    o.onSaved?.({ name: r.name, command: r.command, dir: r.dir });
    const { ok: _ok, ...body } = r;
    return reply.code(201).send(body);
  });

  return drafts;
}

function safeUser(): string {
  try {
    return userInfo().username || 'user';
  } catch {
    return 'user';
  }
}
