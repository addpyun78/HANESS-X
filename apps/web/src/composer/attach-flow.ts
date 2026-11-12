import type { Attachment } from './types.js';

/**
 * T-101 1A.7·1A.8 화면 쪽 첨부 흐름 (주입 인터페이스).
 * 프로젝트(0-2)·초안 세션(0B.12)·"어디서 작업할까요?" 카드(0B.15)가 생기면 App이 이 함수들을 넘긴다.
 *  1) 프로젝트를 아직 안 골랐으면 카드 먼저 (닫으면 첨부 취소)
 *  2) 지금 세션이 초안이면 그 순간 정식 저장 (첨부가 첫 메시지 역할)
 *  3) 서버에 올려 <프로젝트>/.harness-x/attachments/<세션>/에 저장
 */

export interface UiSession {
  id: string;
  draft: boolean;
  projectRoot?: string;
}

export interface AttachFlowDeps {
  currentSession(): UiSession | undefined;
  /** "어디서 작업할까요?" 카드 (0B.15) → 고른 프로젝트 루트, 닫으면 undefined */
  pickProject(): Promise<string | undefined>;
  /** 초안 세션 정식 저장 (0B.12) → 저장된 세션 id */
  saveDraft(s: UiSession, projectRoot: string): Promise<string>;
  /** 첨부 올리기 (서버 저장) */
  upload(sessionId: string, projectRoot: string, files: Attachment[]): Promise<void>;
}

export type UiAttachResult =
  { status: 'cancelled' } | { status: 'saved'; sessionId: string; projectRoot: string; savedDraft: boolean };

export const NO_PROJECT_MESSAGE = '어디서 작업할까요? 먼저 프로젝트 폴더를 골라 주세요.';

export async function runAttachFlow(d: AttachFlowDeps, files: Attachment[]): Promise<UiAttachResult> {
  const cur = d.currentSession();
  const projectRoot = cur?.projectRoot ?? (await d.pickProject());
  if (!projectRoot || !cur) return { status: 'cancelled' };
  let sessionId = cur.id;
  const savedDraft = cur.draft;
  if (cur.draft) sessionId = await d.saveDraft(cur, projectRoot);
  await d.upload(sessionId, projectRoot, files);
  return { status: 'saved', sessionId, projectRoot, savedDraft };
}
