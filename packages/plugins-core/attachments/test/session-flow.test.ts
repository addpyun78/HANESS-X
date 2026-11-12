import { checkPlainKorean } from '@harness-x/approvals';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AttachmentStore,
  MESSAGES,
  attachToSession,
  type AttachSessionHost,
  type SessionRef,
} from '../src/index.js';
import { tempProject } from './helpers.js';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

/** 0-2 세션 목록 흉내: 초안은 다른 세션으로 옮기면 사라진다(0B.12), 저장된 세션은 남는다 */
class FakeSessions implements AttachSessionHost {
  saved = new Map<string, { projectRoot: string; first: string[] }>();
  active: SessionRef | undefined;
  picks: (string | undefined)[] = [];
  pickCalls = 0;
  private seq = 0;

  newDraft(projectRoot?: string): SessionRef {
    this.active = { id: `draft-${++this.seq}`, draft: true, ...(projectRoot ? { projectRoot } : {}) };
    return this.active;
  }
  switchTo(id: string): void {
    // 초안은 버려지고 저장된 세션으로 이동
    const s = this.saved.get(id);
    this.active = s ? { id, draft: false, projectRoot: s.projectRoot } : undefined;
  }
  current() {
    return this.active;
  }
  async pickProject() {
    this.pickCalls++;
    return this.picks.shift();
  }
  async saveDraft(d: SessionRef, first: { projectRoot: string; attachmentNames: string[] }) {
    const id = `s-${d.id.replace('draft-', '')}`;
    this.saved.set(id, { projectRoot: first.projectRoot, first: first.attachmentNames });
    this.active = { id, draft: false, projectRoot: first.projectRoot };
    return id;
  }
}

describe('1A.7 초안 세션에 파일을 놓으면 그 순간 정식 저장 (첨부가 첫 메시지)', () => {
  it('첨부만 하고 다른 세션으로 옮겨도 세션·첨부가 남는다', async () => {
    const p = tempProject();
    cleanups.push(p.cleanup);
    const host = new FakeSessions();
    host.saved.set('s-other', { projectRoot: p.root, first: ['x'] });
    host.newDraft(p.root);
    const r = await attachToSession({ host }, [{ name: '화면.png', data: Buffer.from('png-ish') }]);
    expect(r.status).toBe('saved');
    if (r.status !== 'saved') return;
    expect(r.savedDraft).toBe(true);
    expect(host.saved.get(r.sessionId)?.first).toEqual(['화면.png']);

    host.switchTo('s-other');
    host.switchTo(r.sessionId);
    expect(host.current()).toMatchObject({ id: r.sessionId, draft: false });
    const store = new AttachmentStore({ projectRoot: p.root });
    expect(store.list(r.sessionId).map((a) => a.originalName)).toEqual(['화면.png']);
  });

  it('이미 저장된 세션이면 다시 저장하지 않는다', async () => {
    const p = tempProject();
    cleanups.push(p.cleanup);
    const host = new FakeSessions();
    host.saved.set('s-9', { projectRoot: p.root, first: [] });
    host.switchTo('s-9');
    const r = await attachToSession({ host }, [{ name: 'a.txt', data: Buffer.from('a') }]);
    expect(r).toMatchObject({ status: 'saved', sessionId: 's-9', savedDraft: false });
  });
});

describe('1A.8 프로젝트를 아직 안 골랐으면 "어디서 작업할까요?" 카드 먼저, 고른 뒤 그 프로젝트에 저장', () => {
  it('카드에서 고른 프로젝트 폴더에 저장', async () => {
    const p = tempProject();
    cleanups.push(p.cleanup);
    const host = new FakeSessions();
    host.newDraft();
    host.picks.push(p.root);
    const r = await attachToSession({ host }, [{ name: '기획서.hwpx', data: Buffer.from('x') }]);
    expect(host.pickCalls).toBe(1);
    expect(r).toMatchObject({ status: 'saved', projectRoot: p.root });
    if (r.status === 'saved') expect(r.attachments[0]!.storedPath.startsWith(p.root)).toBe(true);
  });

  it('카드를 닫으면 아무것도 저장하지 않고 쉬운 말 안내', async () => {
    const host = new FakeSessions();
    host.newDraft();
    host.picks.push(undefined);
    const r = await attachToSession({ host }, [{ name: 'a.txt', data: Buffer.from('a') }]);
    expect(r).toEqual({ status: 'cancelled', message: MESSAGES.noProject });
    expect(host.saved.size).toBe(0);
    expect(checkPlainKorean(MESSAGES.noProject).ok).toBe(true);
  });

  it('프로젝트가 있는 세션이면 카드를 띄우지 않는다', async () => {
    const p = tempProject();
    cleanups.push(p.cleanup);
    const host = new FakeSessions();
    host.newDraft(p.root);
    await attachToSession({ host }, [{ name: 'a.txt', data: Buffer.from('a') }]);
    expect(host.pickCalls).toBe(0);
  });
});
