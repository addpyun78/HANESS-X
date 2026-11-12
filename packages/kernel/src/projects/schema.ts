import { RunModeSchema } from '@harness-x/protocol';
import { z } from 'zod';

/**
 * T-101 0-2 프로젝트와 새 세션 — 스키마
 *
 * 프로젝트는 독립된 개념이다: id(UUID)는 만들 때 한 번 정하고 바뀌지 않는다.
 * 이름(name)은 표시용일 뿐이고, 경로(rootPath)는 [다시 연결]로만 바뀐다 (0B.38 — 이름과 경로를 한 값처럼 다루지 않는다).
 */

/** 0B.40 프로젝트 기본값. 비운 칸은 전체 설정을 따른다 */
export const ProjectDefaultsSchema = z.object({
  engine: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  mode: z.string().min(1).optional(),
  permission: z.string().min(1).optional(),
  agent: z.string().min(1).optional(),
});
export type ProjectDefaults = z.infer<typeof ProjectDefaultsSchema>;

/** 0B.2 */
export const ProjectSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  rootPath: z.string().min(1),
  gitRoot: z.string().min(1).optional(),
  branch: z.string().min(1).optional(),
  createdAt: z.iso.datetime({ offset: true }),
  lastOpenedAt: z.iso.datetime({ offset: true }),
  pinned: z.boolean(),
  order: z.number().int().nonnegative(),
  missing: z.boolean(),
  /** 0B.16 임시 작업 공간 (… 메뉴 [다른 폴더로 옮기기]) */
  scratch: z.boolean().optional(),
  defaults: ProjectDefaultsSchema.optional(),
});
export type Project = z.infer<typeof ProjectSchema>;

export const ProjectsFileSchema = z.object({
  version: z.literal(1),
  /** 지금 고른 프로젝트 (사이드바 = 상단 바 = + 메뉴 기준, 0B.31) */
  current: z.string().optional(),
  /** 0B.16 임시 작업 번호 ("임시 작업 N") */
  scratchSeq: z.number().int().nonnegative().optional(),
  projects: z.array(ProjectSchema),
});
export type ProjectsFile = z.infer<typeof ProjectsFileSchema>;

/** 0B.3 프로젝트 폴더 안 표식 `.harness-x/project.json` (Git에 올려도 되는 파일) */
export const ProjectMarkerSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  createdAt: z.iso.datetime({ offset: true }),
  /** T-101 6B.14 프로젝트 범위 설정 값 (settings.json과 같은 중첩 객체 — ProjectSettingsIO가 읽고 씀) */
  settings: z.record(z.string(), z.unknown()).optional(),
});
export type ProjectMarker = z.infer<typeof ProjectMarkerSchema>;

// ── 세션 ────────────────────────────────────────────────────

/** 사이드바 상태 아이콘: ● 진행 중 / ✋ 확인 필요 / ⏸ 멈춤 / ✓ 완료 (0B.24) */
export const SESSION_STATES = ['running', 'needs-approval', 'paused', 'done', 'idle', 'error'] as const;
export type SessionState = (typeof SESSION_STATES)[number];

/** 세션이 어디서 만들어졌나 (0B.37 — 경로는 여럿이어도 등록 함수는 하나) */
export const SESSION_ORIGINS = ['ui', 'slash', 'cli', 'resume', 'api', 'import'] as const;
export type SessionOrigin = (typeof SESSION_ORIGINS)[number];

export const SessionRecordSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9._-]{1,128}$/),
  /** 0B.39 만들 때 직접 저장. null = "프로젝트 없음" 묶음 (옛 세션 마이그레이션에서만) */
  projectId: z.string().nullable(),
  title: z.string(),
  /** 0B.19 사용자가 바꾼 제목은 AI 제안으로 덮지 않는다 */
  titleLocked: z.boolean(),
  status: z.enum(SESSION_STATES),
  engine: z.string().optional(),
  model: z.string().optional(),
  /** 3A.2 실행 모드 (plan | normal | auto) — 있으면 사이드바에 배지. 모르는 옛 값은 버린다 */
  mode: RunModeSchema.optional().catch(undefined),
  permission: z.string().optional(),
  agent: z.string().optional(),
  agentIcon: z.string().optional(),
  cwd: z.string(),
  origin: z.enum(SESSION_ORIGINS),
  /** 0B.12 초안: 첫 메시지 전까지 저장하지 않는다 */
  draft: z.boolean(),
  messageCount: z.number().int().nonnegative(),
  archived: z.boolean(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  /** 0B.24 마지막 활동 시각 */
  lastActivityAt: z.iso.datetime({ offset: true }),
  /** 완료 시각 (0B.30 30일 보관 제안) */
  doneAt: z.iso.datetime({ offset: true }).optional(),
});
export type SessionRecord = z.infer<typeof SessionRecordSchema>;
