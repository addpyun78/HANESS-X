import { z } from 'zod';

/**
 * HarnessEvent — 모든 엔진(Claude Code·Codex·Antigravity·로컬 LLM)의 출력을
 * 하나의 형식으로 정규화한 이벤트. 이벤트 로그·UI·체크리스트가 모두 이 형식만 본다.
 */

// ── 2.1 공통 필드 ────────────────────────────────────────────────
export const EventBaseSchema = z.object({
  /** 이벤트 고유 ID (ULID/UUID 등 문자열) */
  id: z.string().min(1),
  /** ISO-8601 시각 */
  ts: z.iso.datetime({ offset: true }),
  /** 하네스 세션 ID */
  sessionId: z.string().min(1),
  /** 이벤트를 만든 엔진 ID (예: claude-code, codex) */
  engineId: z.string().min(1).optional(),
  /** 관련 체크리스트 항목 ID */
  itemId: z.string().min(1).optional(),
});
export type EventBase = z.infer<typeof EventBaseSchema>;

// ── 2.2 / 2.3 이벤트별 스키마 ────────────────────────────────────
export const AssistantTextEventSchema = EventBaseSchema.extend({
  type: z.literal('assistant_text'),
  text: z.string(),
  /** 스트리밍 조각이면 true, 최종 텍스트면 false */
  partial: z.boolean().optional(),
});

export const ToolCallEventSchema = EventBaseSchema.extend({
  type: z.literal('tool_call'),
  callId: z.string().min(1),
  tool: z.string().min(1),
  input: z.unknown(),
});

export const ToolResultEventSchema = EventBaseSchema.extend({
  type: z.literal('tool_result'),
  callId: z.string().min(1),
  ok: z.boolean(),
  output: z.unknown(),
});

export const FileChangeEventSchema = EventBaseSchema.extend({
  type: z.literal('file_change'),
  path: z.string().min(1),
  change: z.enum(['create', 'modify', 'delete', 'rename']),
  /** rename일 때 이전 경로 */
  fromPath: z.string().min(1).optional(),
  diff: z.string().optional(),
});

export const UsageEventSchema = EventBaseSchema.extend({
  type: z.literal('usage'),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative().optional(),
  costUsd: z.number().nonnegative().optional(),
  /** 한도 대비 사용률 0~1 */
  quotaRatio: z.number().min(0).max(1).optional(),
});

export const ErrorEventSchema = EventBaseSchema.extend({
  type: z.literal('error'),
  code: z.string().min(1),
  message: z.string(),
  retryable: z.boolean().optional(),
});

export const TurnEndEventSchema = EventBaseSchema.extend({
  type: z.literal('turn_end'),
  reason: z.enum(['completed', 'interrupted', 'error', 'max_turns', 'blocked']),
  /** reason 'blocked'(종료 차단, T-028)일 때: 남은(done이 아닌) 항목 수 */
  remaining: z.number().int().nonnegative().optional(),
  /** reason 'blocked'일 때: 다음에 할 항목 */
  nextItemId: z.string().min(1).optional(),
  nextItemTitle: z.string().optional(),
});

export const ApprovalRequestEventSchema = EventBaseSchema.extend({
  type: z.literal('approval_request'),
  approvalId: z.string().min(1),
  kind: z.string().min(1),
  title: z.string(),
  detail: z.record(z.string(), z.unknown()).optional(),
  options: z.array(z.string().min(1)).min(1),
});

/**
 * 승인 카드 처리 알림 (T-100 H.10). HarnessEvent 9종 밖의 커널 기록이지만 /ws/events로 함께 나간다.
 * undone: "방금 선택 취소"로 되돌린 경우
 */
export const APPROVAL_RESOLVED_TYPE = 'approval_resolved';
export const ApprovalResolvedEventSchema = EventBaseSchema.extend({
  type: z.literal(APPROVAL_RESOLVED_TYPE),
  approvalId: z.string().min(1),
  choice: z.string().min(1),
  remember: z.boolean().optional(),
  undone: z.boolean().optional(),
});
export type ApprovalResolvedEvent = z.infer<typeof ApprovalResolvedEventSchema>;

export const ChecklistChangeEventSchema = EventBaseSchema.extend({
  type: z.literal('checklist_change'),
  /** 변경된 항목 (공통 필드 itemId와 별개로 필수) */
  changedItemId: z.string().min(1),
  from: z.string().nullable(),
  to: z.string().min(1),
  version: z.number().int().nonnegative(),
});

export const HarnessEventSchema = z.discriminatedUnion('type', [
  AssistantTextEventSchema,
  ToolCallEventSchema,
  ToolResultEventSchema,
  FileChangeEventSchema,
  UsageEventSchema,
  ErrorEventSchema,
  TurnEndEventSchema,
  ApprovalRequestEventSchema,
  ChecklistChangeEventSchema,
]);

export type AssistantTextEvent = z.infer<typeof AssistantTextEventSchema>;
export type ToolCallEvent = z.infer<typeof ToolCallEventSchema>;
export type ToolResultEvent = z.infer<typeof ToolResultEventSchema>;
export type FileChangeEvent = z.infer<typeof FileChangeEventSchema>;
export type UsageEvent = z.infer<typeof UsageEventSchema>;
export type ErrorEvent = z.infer<typeof ErrorEventSchema>;
export type TurnEndEvent = z.infer<typeof TurnEndEventSchema>;
export type ApprovalRequestEvent = z.infer<typeof ApprovalRequestEventSchema>;
export type ChecklistChangeEvent = z.infer<typeof ChecklistChangeEventSchema>;
export type HarnessEvent = z.infer<typeof HarnessEventSchema>;
export type HarnessEventType = HarnessEvent['type'];

export const HARNESS_EVENT_TYPES = [
  'assistant_text',
  'tool_call',
  'tool_result',
  'file_change',
  'usage',
  'error',
  'turn_end',
  'approval_request',
  'checklist_change',
] as const satisfies readonly HarnessEventType[];

export function parseHarnessEvent(value: unknown): HarnessEvent {
  return HarnessEventSchema.parse(value);
}
