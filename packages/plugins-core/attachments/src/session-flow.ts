import type { Attachment } from '@harness-x/protocol';
import { MESSAGES } from './messages.js';
import { AttachmentStore, type AddInput, type AttachmentStoreOptions } from './store.js';

/**
 * 1A.7·1A.8 파일을 놓았을 때 세션·프로젝트 정하기.
 * 프로젝트(0-2)·초안 세션(0B.12)·"어디서 작업할까요?" 카드(0B.15)는 다른 구역이 만들므로 주입받는다.
 *  - 프로젝트를 아직 안 골랐으면 카드부터 → 고른 프로젝트에 저장 (취소하면 아무것도 저장 안 함)
 *  - 지금 세션이 초안이면 그 순간 정식 저장 (첨부가 첫 메시지 역할)
 */

export interface SessionRef {
  id: string;
  /** 아직 저장 안 된 빈 세션 (0B.12) */
  draft: boolean;
  /** 세션이 속한 프로젝트 루트 (없으면 아직 안 고름) */
  projectRoot?: string;
}

export interface AttachSessionHost {
  current(): SessionRef | undefined;
  /** "어디서 작업할까요?" 카드 → 고른 프로젝트 루트 (취소 undefined) */
  pickProject(): Promise<string | undefined>;
  /** 초안 세션을 정식 저장 (첨부가 첫 메시지). 저장된 세션 id를 돌려준다 */
  saveDraft(draft: SessionRef, first: { projectRoot: string; attachmentNames: string[] }): Promise<string>;
  /** 새 세션 만들기 (세션이 아예 없을 때) */
  createSession?(projectRoot: string): Promise<SessionRef>;
}

export type AttachFlowResult =
  | { status: 'cancelled'; message: string }
  | {
      status: 'saved';
      sessionId: string;
      projectRoot: string;
      attachments: Attachment[];
      savedDraft: boolean;
    };

export interface AttachFlowOptions extends Omit<AttachmentStoreOptions, 'projectRoot'> {
  host: AttachSessionHost;
}

export async function attachToSession(
  o: AttachFlowOptions,
  inputs: readonly AddInput[],
): Promise<AttachFlowResult> {
  let cur = o.host.current();
  const projectRoot = cur?.projectRoot ?? (await o.host.pickProject());
  if (!projectRoot) return { status: 'cancelled', message: MESSAGES.noProject };
  if (!cur) {
    if (!o.host.createSession) return { status: 'cancelled', message: MESSAGES.noProject };
    cur = await o.host.createSession(projectRoot);
  }
  let sessionId = cur.id;
  let savedDraft = false;
  if (cur.draft) {
    sessionId = await o.host.saveDraft(cur, { projectRoot, attachmentNames: inputs.map((i) => i.name) });
    savedDraft = true;
  }
  const store = new AttachmentStore({ ...o, projectRoot });
  const added = await store.addMany(sessionId, inputs);
  return { status: 'saved', sessionId, projectRoot, attachments: added.map((r) => r.attachment), savedDraft };
}
