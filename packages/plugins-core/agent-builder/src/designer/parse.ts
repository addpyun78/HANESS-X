import {
  AgentDraftSchema,
  DraftQuestionsSchema,
  type AgentDraft,
  type DraftQuestion,
} from '@harness-x/protocol';
import { jsonBlocks } from '../contract.js';
import { draftPlainIssues } from './plain.js';

/**
 * P4-C.5 응답 파싱: JSON만 추출(T-042 결정적 추출 jsonBlocks 재사용 — 마지막 JSON 객체),
 * AgentDraft 스키마 검사. 실패하면 오류 목록을 만들어 1회 재요청한다(designer.ts).
 */

export const MAX_SCHEMA_RETRIES = 1;

export type DesignerReply =
  | { kind: 'draft'; draft: AgentDraft }
  | { kind: 'questions'; questions: DraftQuestion[] }
  | { kind: 'invalid'; errors: string[]; raw?: unknown };

/** 응답 텍스트 → 초안 / 질문 / 오류 목록 */
export function parseDesignerReply(
  text: string | undefined,
  opts: { allowQuestions?: boolean } = {},
): DesignerReply {
  if (!text) return { kind: 'invalid', errors: ['응답이 비었거나 도구를 써서 버려졌습니다'] };
  const blocks = jsonBlocks(text);
  const raw = blocks[blocks.length - 1];
  if (!raw) return { kind: 'invalid', errors: ['JSON 객체를 찾지 못했습니다'] };
  if ('questions' in raw && opts.allowQuestions !== false) {
    const q = DraftQuestionsSchema.safeParse(raw);
    if (q.success) return { kind: 'questions', questions: q.data.questions };
    return { kind: 'invalid', errors: zodErrors(q.error), raw };
  }
  const r = AgentDraftSchema.safeParse(raw);
  if (!r.success) return { kind: 'invalid', errors: zodErrors(r.error), raw };
  const plain = draftPlainIssues(r.data);
  if (plain.length)
    return {
      kind: 'invalid',
      errors: plain.map((p) => `${p.path}: not plain Korean (${p.problems.join('; ')})`),
      raw,
    };
  return { kind: 'draft', draft: r.data };
}

function zodErrors(e: { issues: { path: PropertyKey[]; message: string }[] }): string[] {
  return e.issues.map((i) => (i.path.length ? `${i.path.map(String).join('.')}: ` : '') + i.message);
}

/** 재요청 글: 오류 목록 + 받은 값 */
export function schemaRetryMessage(errors: readonly string[], raw: unknown): string {
  return [
    'Your previous reply did not match the draft format. Fix ONLY these problems and reply with the full JSON object again:',
    ...errors.map((e) => `- ${e}`),
    raw === undefined ? '' : '```json\n' + JSON.stringify(raw, null, 2) + '\n```',
  ]
    .filter(Boolean)
    .join('\n');
}
