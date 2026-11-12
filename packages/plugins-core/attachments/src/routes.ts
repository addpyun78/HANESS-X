import type { Attachment } from '@harness-x/protocol';
import { DEFAULT_CONVERTERS } from './convert.js';
import type { AttachmentLimits } from './limits.js';
import { AttachmentLimitError } from './limits.js';
import { MESSAGES } from './messages.js';
import { ConversionQueue } from './queue.js';
import type { SecretCard } from './secrets.js';
import { AttachmentStore, type AttachmentEventSink } from './store.js';

/**
 * T-101 1A.2·1A.7·1A.8 서버 연결: 세션(0-2)의 프로젝트 폴더에 첨부를 저장한다.
 *   POST /api/sessions/:id/attachments  { files: [{ name, dataBase64 }] }
 *     - 세션이 초안이면 그 순간 정식 저장 (첨부가 첫 메시지 역할, 1A.7)
 *     - 세션에 프로젝트가 없으면 409 no_project (화면은 "어디서 작업할까요?" 카드를 먼저 띄움, 1A.8)
 *   GET  /api/sessions/:id/attachments
 * 커널은 이 패키지에 의존하지 않는다: 커널 cli가 플러그인 모듈의 registerAttachmentRoutes를 찾아 부른다.
 */

export interface AttachmentRouteSession {
  projectRoot?: string;
  draft: boolean;
}

export interface AttachmentRoutesOptions {
  /** 세션 id → 프로젝트 폴더·초안 여부 (없는 세션이면 undefined) */
  session(id: string): AttachmentRouteSession | undefined;
  /** 초안 세션 정식 저장 (0B.12 SessionRegistry.commitDraft) */
  commitDraft(id: string, firstMessage: string): unknown;
  limits?: Partial<AttachmentLimits> | (() => Partial<AttachmentLimits>);
  events?: AttachmentEventSink;
  /** 비밀 카드 (화면 알림으로) */
  onSecret?(sessionId: string, card: SecretCard): void;
}

/** fastify 인스턴스에서 쓰는 부분만 (패키지 의존 없이) */
export interface RouteApp {
  post(
    path: string,
    opts: { bodyLimit?: number },
    handler: (req: { params: unknown; body: unknown }, reply: RouteReply) => unknown,
  ): unknown;
  get(path: string, handler: (req: { params: unknown }, reply: RouteReply) => unknown): unknown;
}
export interface RouteReply {
  code(n: number): RouteReply;
  send(body: unknown): unknown;
}

const MB = 1024 * 1024;

export function registerAttachmentRoutes(app: RouteApp, o: AttachmentRoutesOptions): void {
  const limits = () => (typeof o.limits === 'function' ? o.limits() : o.limits) ?? {};
  const storeFor = (root: string) =>
    new AttachmentStore({ projectRoot: root, limits: limits(), ...(o.events ? { events: o.events } : {}) });

  app.get('/api/sessions/:id/attachments', (req, reply) => {
    const id = (req.params as { id: string }).id;
    const s = o.session(id);
    if (!s) return reply.code(404).send({ error: 'not_found', message: '세션을 찾을 수 없어요.' });
    if (!s.projectRoot) return { attachments: [] };
    return { attachments: storeFor(s.projectRoot).list(id) };
  });

  app.post('/api/sessions/:id/attachments', { bodyLimit: 1100 * MB }, async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const s = o.session(id);
    if (!s) return reply.code(404).send({ error: 'not_found', message: '세션을 찾을 수 없어요.' });
    if (!s.projectRoot) return reply.code(409).send({ error: 'no_project', message: MESSAGES.noProject });
    const files = (req.body as { files?: { name?: unknown; dataBase64?: unknown }[] } | undefined)?.files;
    if (!Array.isArray(files) || files.length === 0)
      return reply.code(400).send({ error: 'invalid', message: '첨부할 파일이 없어요.' });
    const inputs = files.map((f) => ({
      name: typeof f.name === 'string' && f.name ? f.name : 'file',
      data: Buffer.from(typeof f.dataBase64 === 'string' ? f.dataBase64 : '', 'base64'),
    }));
    const store = storeFor(s.projectRoot);
    let added;
    try {
      added = await store.addMany(id, inputs);
    } catch (err) {
      if (err instanceof AttachmentLimitError)
        return reply.code(413).send({ error: err.code, message: err.message });
      throw err;
    }
    // 1A.7 초안이면 지금 정식 저장 (첨부 이름이 첫 메시지)
    if (s.draft) o.commitDraft(id, `첨부: ${inputs.map((i) => i.name).join(', ')}`);
    // 1B.1 형태 바꾸기는 백그라운드 (응답은 바로)
    const q = new ConversionQueue({
      store,
      converters: DEFAULT_CONVERTERS,
      ...(o.events ? { events: o.events } : {}),
      ...(o.onSecret ? { onSecret: (c: SecretCard) => o.onSecret!(id, c) } : {}),
    });
    for (const r of added) if (!r.reused) void q.enqueue(r.attachment);
    const attachments: Attachment[] = added.map((r) => r.attachment);
    return { attachments, savedDraft: s.draft };
  });
}
