import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentDraftSchema } from '@harness-x/protocol';
import { DraftStore } from '../src/drafts/store.js';
import { sampleDraft } from './designer-helpers.js';

const homes: string[] = [];
const newHome = () => {
  const h = mkdtempSync(join(tmpdir(), 'hx-drafts-'));
  homes.push(h);
  return h;
};
afterEach(() => homes.splice(0).forEach((h) => rmSync(h, { recursive: true, force: true })));

const withEngine = (e: string) => {
  const d = AgentDraftSchema.parse(sampleDraft());
  d.nodes[2]!.engine = e;
  return d;
};

describe('초안 저장소 (~/.harness-x/drafts, HOME 주입)', () => {
  it('P4-E.6 버전 v1→v2→v3, 이전 버전 보기, v3 → v1 되돌리기(새 버전 v4로 남음)', () => {
    const s = new DraftStore({ home: newHome() });
    const r = s.create({
      request: '검수 에이전트',
      draft: withEngine('antigravity'),
      designEngine: 'claude-code',
    });
    expect(r.versions.map((v) => v.v)).toEqual([1]);
    s.addVersion(r.id, withEngine('claude-code'), 'ai-patch', '검사 AI를 바꿨어요.');
    s.addVersion(r.id, withEngine('codex'), 'canvas');
    expect(s.version(r.id, 1)!.draft.nodes[2]!.engine).toBe('antigravity');
    const back = s.revert(r.id, 1);
    expect(back.versions.map((v) => [v.v, v.source])).toEqual([
      [1, 'ai'],
      [2, 'ai-patch'],
      [3, 'canvas'],
      [4, 'revert'],
    ]);
    expect(s.current(r.id)!.nodes[2]!.engine).toBe('antigravity');
    expect(() => s.revert(r.id, 9)).toThrow();
  });

  it('P4-F.9 자동 보관(working)은 버전을 늘리지 않고, 새로 열어도(새 인스턴스) 남는다', () => {
    const home = newHome();
    const a = new DraftStore({ home });
    const r = a.create({ request: '검수', draft: withEngine('antigravity') });
    a.saveWorking(r.id, withEngine('codex'));
    const b = new DraftStore({ home });
    expect(b.get(r.id)!.versions).toHaveLength(1);
    expect(b.current(r.id)!.nodes[2]!.engine).toBe('codex');
    b.addVersion(r.id, withEngine('codex'), 'canvas');
    expect(b.get(r.id)!.working).toBeUndefined();
  });

  it('P4-F.10 목록·삭제, 30일 지난 초안은 stale 표시만 (자동 삭제 없음)', () => {
    const home = newHome();
    let now = new Date('2026-10-01T00:00:00Z');
    const s = new DraftStore({ home, now: () => now });
    const old = s.create({ request: '오래된 것', draft: withEngine('codex') });
    now = new Date('2026-11-10T00:00:00Z');
    const fresh = s.create({ request: '새 것', draft: withEngine('codex') });
    now = new Date('2026-11-11T00:00:00Z');
    const list = s.list();
    expect(list.map((x) => [x.id, x.stale])).toEqual([
      [fresh.id, false],
      [old.id, true],
    ]);
    expect(s.get(old.id)).toBeDefined(); // 목록을 봐도 지우지 않는다
    expect(s.remove(old.id)).toBe(true);
    expect(s.list().map((x) => x.id)).toEqual([fresh.id]);
  });
});
