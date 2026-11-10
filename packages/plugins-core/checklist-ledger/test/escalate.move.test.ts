import { existsSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Escalator, moveArtifact, rebasePath, rewritePathRefs } from '../src/escalate.js';
import { loadDefaultGlossary } from '../src/glossary.js';
import { ChecklistLedger } from '../src/ledger.js';
import { ManifestStore } from '../src/manifest.js';
import { CASE } from './escalate-fixtures.js';
import { tempDir } from './helpers.js';

describe('27.5 "이동 승인" → manifest 경로 갱신 + 참조 항목 일괄 갱신', () => {
  let t: ReturnType<typeof tempDir>;
  let manifest: ManifestStore;
  let ledger: ChecklistLedger;
  const events: Record<string, unknown>[] = [];
  const log = { append: (e: unknown) => events.push(e as Record<string, unknown>) };

  beforeEach(() => {
    t = tempDir('hx-move-');
    events.length = 0;
    manifest = new ManifestStore({ dir: t.dir, log, sessionId: 's1' });
    manifest.lock(
      [
        { artifactId: 'art.mobile-app', displayName: '하네스/모바일', kind: 'dir' },
        {
          artifactId: 'art.mobile-login',
          displayName: '로그인',
          kind: 'file',
          path: 'harness/mobile/login.kt',
        },
        { artifactId: 'art.web', displayName: '웹', kind: 'dir', path: 'harness/web' },
      ],
      { glossary: loadDefaultGlossary() },
    );
    ledger = new ChecklistLedger({ dir: t.dir, sessionId: 's1' });
    ledger.create([
      {
        id: '1',
        title: '모바일 앱 스캐폴드',
        artifactId: 'art.mobile-app',
        acceptance: [{ type: 'file_exists' }],
      },
      {
        id: '2',
        title: '로그인 화면',
        artifactId: 'art.mobile-login',
        deps: ['1'],
        acceptance: [{ type: 'test', run: 'pnpm test harness/mobile/login' }],
      },
      {
        id: '3',
        title: '웹 셸',
        artifactId: 'art.web',
        acceptance: [{ type: 'test', run: 'pnpm test harness/web harness/mobile-old' }],
      },
      {
        id: '4',
        title: '웹에서 모바일 자산 참조',
        artifactId: 'art.web',
        deps: ['1'],
        acceptance: [{ type: 'command', run: 'test -f ./harness/mobile/assets/logo.png' }],
      },
    ]);
    ledger.transition('1', 'doing');
    ledger.transition('1', 'verifying');
  });
  afterEach(() => t.cleanup());

  it('의존 항목의 경로 갱신', async () => {
    const esc = new Escalator({ dir: t.dir, sessionId: 's1', ledger, manifest });
    const out = await esc.escalate(CASE);
    if (out.status !== 'pending') throw new Error('pending 기대');
    const res = esc.resolve(out.approvalId, 'move');
    expect(res).toMatchObject({ itemId: '1', status: 'done', verdict: { level: 5, verdict: 'relocated' } });
    expect(res.moved?.moved).toEqual([
      { artifactId: 'art.mobile-app', from: 'harness/mobile', to: 'ai/mobile' },
      { artifactId: 'art.mobile-login', from: 'harness/mobile/login.kt', to: 'ai/mobile/login.kt' },
    ]);
    expect(res.moved?.updatedItems).toEqual(['1', '2', '4']);

    // manifest 경로 갱신 (개정 이벤트·이전 개정본 보관)
    expect(manifest.resolve('art.mobile-app').path).toBe('ai/mobile');
    expect(manifest.resolve('art.mobile-login').path).toBe('ai/mobile/login.kt');
    expect(manifest.resolve('art.web').path).toBe('harness/web');
    expect(existsSync(manifest.archiveFile(1))).toBe(true);
    expect(events.filter((e) => e.type === 'manifest_revision')).toHaveLength(1);

    // 참조 항목 일괄 갱신
    const items = new Map(ledger.get().items.map((i) => [i.id, i]));
    expect(items.get('2')!.acceptance).toEqual([
      { type: 'test', run: 'pnpm test ai/mobile/login', expectExit: 0 },
    ]);
    expect(items.get('2')!.evidence.at(-1)).toMatchObject({
      kind: 'path_updated',
      from: 'harness/mobile',
      to: 'ai/mobile',
      artifactPath: 'ai/mobile/login.kt',
    });
    expect(items.get('4')!.acceptance[0]).toMatchObject({ run: 'test -f ./ai/mobile/assets/logo.png' });
    expect(items.get('3')!.acceptance[0]).toMatchObject({ run: 'pnpm test harness/web harness/mobile-old' });
    expect(items.get('3')!.evidence).toEqual([]);
    // 상태는 이어받는다
    expect(items.get('1')!.status).toBe('done');
    expect(items.get('2')!.status).toBe('todo');
  });

  it('경로 도우미', () => {
    expect(rebasePath('a/b', 'a/b', 'x')).toBe('x');
    expect(rebasePath('a/b/c.kt', 'a/b', 'x/y')).toBe('x/y/c.kt');
    expect(rebasePath('a/bc', 'a/b', 'x')).toBeNull();
    expect(rewritePathRefs('run a/b && cat "a/b/c" a/bc', 'a/b', 'x')).toBe('run x && cat "x/c" a/bc');
    expect(() => moveArtifact({ manifest, artifactId: 'art.none', newPath: 'x', reason: 'r' })).toThrow(
      /art.none/,
    );
  });
});
