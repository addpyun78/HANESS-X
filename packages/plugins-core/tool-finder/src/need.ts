import { z } from 'zod';

/**
 * P3-A.2 필요한 도구 (ToolNeed)
 *   capability  쉬운 말 능력 설명 (예: "동영상에서 소리만 뽑아내기") — 검색어는 이것만 쓴다(B.3)
 *   why         왜 필요한지 (화면 표시용, 검색어에는 넣지 않는다)
 *   requiredBy  기다리는 체크리스트 항목(itemId) 또는 에이전트 초안 노드(nodeId)
 *   constraints os(현재 환경) · offline(인터넷 없이 써야 하는지) · budget(tools.budget)
 */

export const TOOL_BUDGETS = ['free-only', 'free-first', 'any'] as const;
export const ToolBudgetSchema = z.enum(TOOL_BUDGETS);
export type ToolBudget = z.infer<typeof ToolBudgetSchema>;

/** 사용자 환경: Windows / WSL(Windows + 리눅스) / 그 밖의 유닉스 */
export const USER_OS = ['windows', 'wsl', 'posix'] as const;
export const UserOsSchema = z.enum(USER_OS);
export type UserOs = z.infer<typeof UserOsSchema>;

export const RequiredBySchema = z.union([
  z.object({ itemId: z.string().min(1) }).strict(),
  z.object({ nodeId: z.string().min(1) }).strict(),
]);
export type RequiredBy = z.infer<typeof RequiredBySchema>;

export const ToolNeedConstraintsSchema = z
  .object({
    os: UserOsSchema,
    offline: z.boolean().default(false),
    budget: ToolBudgetSchema.default('free-first'),
  })
  .strict();

/** 필요가 생긴 곳 (A.1 발동 시점 4가지) */
export const NEED_SOURCES = ['checklist', 'agent-gap', 'user', 'engine'] as const;
export const NeedSourceSchema = z.enum(NEED_SOURCES);
export type NeedSource = z.infer<typeof NeedSourceSchema>;

export const ToolNeedSchema = z
  .object({
    capability: z.string().trim().min(2).max(80),
    why: z.string().default(''),
    requiredBy: RequiredBySchema.optional(),
    constraints: ToolNeedConstraintsSchema,
    source: NeedSourceSchema.default('user'),
  })
  .strict();
export type ToolNeed = z.infer<typeof ToolNeedSchema>;
export type ToolNeedInput = z.input<typeof ToolNeedSchema>;

export function parseToolNeed(v: unknown): ToolNeed {
  return ToolNeedSchema.parse(v);
}

/** 같은 필요인지 비교하는 열쇠 (공백·대소문자·문장부호 무시) */
export function needKey(capability: string): string {
  return capability
    .normalize('NFC')
    .toLowerCase()
    .replace(/[\s\p{P}]+/gu, '');
}

/** 화면용 "(항목 4.2)" 꼬리표 */
export function requiredByLabel(r: RequiredBy | undefined): string {
  if (!r) return '';
  return 'itemId' in r ? `항목 ${r.itemId}` : `에이전트 칸 ${r.nodeId}`;
}
