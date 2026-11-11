import { diffDrafts, type AgentDraft, type DraftChange, type DraftQuestion } from '@harness-x/protocol';
import type { Inventory } from '../inventory/schema.js';
import { DEFAULT_PICK_LIMIT, pickRelevant } from '../inventory/relevance.js';
import {
  fabricationRetryMessage,
  findUnknownRefs,
  MAX_FABRICATION_RETRIES,
  moveUnknownToGaps,
} from './assets.js';
import { assignCriticEngines, type CriticNotice } from './critic.js';
import { checkDraftEngines, type EngineSuggestion } from './engines.js';
import { MAX_SCHEMA_RETRIES, parseDesignerReply, schemaRetryMessage } from './parse.js';
import { checkPatchedDraft, parsePatchReply, type PatchOp } from './patch.js';
import { enforcePlainDraft, enforcePlainQuestions } from './plain.js';
import { buildDesignPrompt, buildEditPrompt, type DesignerPrompt } from './prompt.js';
import type { DesignerAsk } from './session.js';
import { DEFAULT_BUILDER_SETTINGS, type BuilderSettings } from './settings.js';
import { checkStructure, type StructureNotice } from './structure.js';

/**
 * P4-C 설계기: 요청 → (되묻기) → 초안.
 *   C.3 모호하면 질문 ≤ builder.maxQuestions (선택지 버튼, 쉬운 말), "알아서 해 줘" = skipQuestions
 *   C.5 JSON만 추출 + 스키마 실패 시 오류 목록과 1회 재요청
 *   C.6 지어낸 id → 최대 2회 재요청 → 그래도 있으면 gaps로
 *   C.8 구조 교정·경고 → C.9 검사 담당 다른 엔진 → C.7 엔진 사용 가능 제안
 * P4-E.2/E.3 말로 고치기: 패치만 받아 검사 뒤 미리보기로 돌려준다(적용은 사용자가 [적용]).
 * 설계기에는 저장 기능이 없다(P4-F.1). 응답에 "저장해라"가 있어도 할 수 있는 일이 없다.
 */

export interface DesignOptions {
  /** 사용자가 "알아서 해 줘"를 눌렀다 (질문 생략) */
  skipQuestions?: boolean;
  /** 앞서 물은 질문에 고른 답 */
  answers?: readonly { question: string; answer: string }[];
  signal?: AbortSignal;
}

export type DesignNotice =
  | ({ source: 'structure' } & StructureNotice)
  | ({ source: 'critic' } & CriticNotice)
  | { source: 'fabrication'; message: string; ids: string[] };

export type DesignResult =
  | { kind: 'questions'; questions: DraftQuestion[] }
  | {
      kind: 'draft';
      draft: AgentDraft;
      notices: DesignNotice[];
      engineSuggestions: EngineSuggestion[];
      /** 설계 AI에 물은 횟수 */
      calls: number;
    }
  | { kind: 'failed'; message: string; calls: number };

export type EditResult =
  | { ok: true; patch: PatchOp[]; draft: AgentDraft; changes: DraftChange[] }
  | { ok: false; message: string; reasons: string[] };

export interface DesignerOptions {
  ask: DesignerAsk;
  /** 전체 인벤토리 (지어낸 자산 검사는 전체 기준, 프롬프트에는 추린 것만) */
  inventory: () => Inventory | Promise<Inventory>;
  settings?: Partial<BuilderSettings>;
}

export const SKIP_QUESTIONS_LABEL = '알아서 해 줘';

export class Designer {
  private readonly settings: BuilderSettings;
  constructor(private readonly o: DesignerOptions) {
    this.settings = { ...DEFAULT_BUILDER_SETTINGS, ...o.settings };
  }

  async design(request: string, opts: DesignOptions = {}): Promise<DesignResult> {
    const inv = await this.o.inventory();
    const picked = pickRelevant(inv, request, DEFAULT_PICK_LIMIT).inventory;
    const maxQuestions = opts.skipQuestions || opts.answers?.length ? 0 : this.settings.maxQuestions;
    const base = buildDesignPrompt({
      request,
      inventory: picked,
      maxQuestions,
      ...(opts.answers ? { answers: opts.answers } : {}),
    });
    let calls = 0;
    const ask = async (extra?: string): Promise<string | undefined> => {
      calls++;
      const p: DesignerPrompt = extra
        ? { system: base.system, user: `${base.user}\n\n## FIX\n${extra}` }
        : base;
      return this.o.ask(p, opts.signal);
    };

    // C.3 / C.5
    let reply = parseDesignerReply(await ask(), { allowQuestions: maxQuestions > 0 });
    for (let i = 0; reply.kind === 'invalid' && i < MAX_SCHEMA_RETRIES; i++)
      reply = parseDesignerReply(await ask(schemaRetryMessage(reply.errors, reply.raw)), {
        allowQuestions: maxQuestions > 0,
      });
    if (reply.kind === 'questions') {
      const questions = enforcePlainQuestions(reply.questions).slice(0, maxQuestions);
      if (questions.length) return { kind: 'questions', questions };
      // 쉬운 말로 물을 수 없으면 질문 없이 바로 초안
      return this.design(request, { ...opts, skipQuestions: true });
    }
    if (reply.kind === 'invalid')
      return {
        kind: 'failed',
        message: 'AI가 초안을 알맞은 모양으로 만들지 못했어요. 조금 더 자세히 말씀해 주세요.',
        calls,
      };
    let draft = reply.draft;

    // C.6 지어낸 자산
    const notices: DesignNotice[] = [];
    let unknown = findUnknownRefs(draft, inv);
    for (let i = 0; unknown.length && i < MAX_FABRICATION_RETRIES; i++) {
      const again = parseDesignerReply(await ask(fabricationRetryMessage(unknown)), {
        allowQuestions: false,
      });
      if (again.kind !== 'draft') continue;
      draft = again.draft;
      unknown = findUnknownRefs(draft, inv);
    }
    if (unknown.length) {
      draft = moveUnknownToGaps(draft, unknown);
      notices.push({
        source: 'fabrication',
        ids: unknown.map((u) => u.id),
        message: `목록에 없는 것 ${unknown.length}개는 빈 칸으로 옮겼어요.`,
      });
    }

    // C.8 → C.9 → C.7
    const st = checkStructure(draft);
    draft = st.draft;
    notices.push(...st.notices.map((n) => ({ source: 'structure' as const, ...n })));
    const cr = assignCriticEngines(draft, inv, request);
    draft = cr.draft;
    notices.push(...cr.notices.map((n) => ({ source: 'critic' as const, ...n })));
    draft = enforcePlainDraft(draft);
    return { kind: 'draft', draft, notices, engineSuggestions: checkDraftEngines(draft, inv), calls };
  }

  /** E.2/E.3 말로 고치기 → 검사를 통과한 패치와 미리보기 초안 (적용은 하지 않는다) */
  async edit(draft: AgentDraft, instruction: string, signal?: AbortSignal): Promise<EditResult> {
    const inv = await this.o.inventory();
    const picked = pickRelevant(inv, `${instruction} ${draft.summary}`, DEFAULT_PICK_LIMIT).inventory;
    const text = await this.o.ask(buildEditPrompt(draft, instruction, picked), signal);
    const p = parsePatchReply(text);
    if (!p.ok)
      return {
        ok: false,
        message: '고칠 내용을 알아듣지 못했어요. 다르게 말씀해 주세요.',
        reasons: [],
      };
    const c = checkPatchedDraft(draft, p.patch, inv);
    if (!c.ok) return { ok: false, message: '이 변경은 적용하지 않았어요.', reasons: c.reasons };
    return { ok: true, patch: p.patch, draft: c.draft, changes: diffDrafts(draft, c.draft) };
  }
}
