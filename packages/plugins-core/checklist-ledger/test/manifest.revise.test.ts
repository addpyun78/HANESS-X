import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EventLog } from '@harness-x/kernel';
import { afterEach, describe, expect, it } from 'vitest';
import { parseGlossary } from '../src/glossary.js';
import {
  ManifestLockedError,
  ManifestRevisionConflictError,
  ManifestStore,
  ManifestTamperedError,
} from '../src/manifest.js';
import { tempDir } from './helpers.js';

const glossary = parseGlossary({
  version: 1,
  terms: [
    { canonical: 'harness', aliases: ['하네스'] },
    { canonical: 'mobile', aliases: ['모바일'] },
  ],
});

describe('22.4 Lock 후 manifest 고정, 변경은 개정 이벤트로만', () => {
  let cleanup = () => {};
  afterEach(() => cleanup());

  function setup() {
    const t = tempDir();
    const log = new EventLog({ root: join(t.dir, 'logs') });
    cleanup = () => {
      log.close();
      t.cleanup();
    };
    const store = new ManifestStore({ dir: join(t.dir, 'ws'), log, sessionId: 's1' });
    return { log, store };
  }

  it('잠기기 전에는 초안 수정 가능, 잠긴 뒤 setDraft·재잠금 거부', () => {
    const { store } = setup();
    store.setDraft('art.tmp', { displayName: '임시', path: 'tmp', kind: 'dir' });
    expect(store.read()?.locked).toBe(false);
    store.lock([{ artifactId: 'art.mobile-app', displayName: '하네스/모바일', kind: 'dir' }], { glossary });
    expect(() => store.setDraft('art.x', { displayName: 'x', path: 'x', kind: 'dir' })).toThrow(
      ManifestLockedError,
    );
    expect(() => store.lock([{ artifactId: 'art.x', displayName: 'x', kind: 'dir' }], { glossary })).toThrow(
      ManifestLockedError,
    );
  });

  it('파일 직접 수정 거부 (digest 불일치 → ManifestTamperedError)', () => {
    const { store } = setup();
    store.lock([{ artifactId: 'art.mobile-app', displayName: '하네스/모바일', kind: 'dir' }], { glossary });
    const raw = JSON.parse(readFileSync(store.file, 'utf8'));
    raw.artifacts['art.mobile-app'].path = 'ai/mobile';
    writeFileSync(store.file, JSON.stringify(raw));
    expect(() => store.read()).toThrow(ManifestTamperedError);
    expect(() => store.resolve('art.mobile-app')).toThrow(ManifestTamperedError);
    expect(() => store.revise({ 'art.mobile-app': null }, { reason: '삭제' })).toThrow(ManifestTamperedError);
  });

  it('revise만 변경 가능: manifest_revision 이벤트·이전 개정본 보관·충돌 감지', () => {
    const { log, store } = setup();
    const r = store.lock([{ artifactId: 'art.mobile-app', displayName: '하네스/모바일', kind: 'dir' }], {
      glossary,
    });
    expect(r.status).toBe('locked');
    const m2 = store.revise(
      { 'art.mobile-app': { displayName: '하네스/모바일', path: 'apps/mobile', kind: 'dir' } },
      { reason: '이동 승인', expectedRevision: 1 },
    );
    expect(m2.revision).toBe(2);
    expect(store.resolve('art.mobile-app').path).toBe('apps/mobile');
    expect(existsSync(store.archiveFile(1))).toBe(true);
    const evs = log.query({ type: 'manifest_revision' });
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({
      revision: 2,
      reason: '이동 승인',
      changes: [
        {
          artifactId: 'art.mobile-app',
          from: { path: 'harness/mobile' },
          to: { path: 'apps/mobile' },
        },
      ],
    });
    expect(() => store.revise({ 'art.mobile-app': null }, { reason: 'x', expectedRevision: 1 })).toThrow(
      ManifestRevisionConflictError,
    );
    store.addPathAlias('art.mobile-app', 'ai/mobile', '동치 인정');
    expect(store.resolve('art.mobile-app').aliases).toEqual(['ai/mobile']);
    expect(store.read()?.revision).toBe(3);
  });
});
