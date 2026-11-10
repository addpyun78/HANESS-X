import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { EventLog } from '@harness-x/kernel';
import { ApprovalRequestEventSchema } from '@harness-x/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { addTerms, parseGlossary } from '../src/glossary.js';
import { ManifestStore, type ManifestDraft } from '../src/manifest.js';
import { tempDir } from './helpers.js';

const glossary = parseGlossary({
  version: 1,
  terms: [
    { canonical: 'harness', aliases: ['하네스'] },
    { canonical: 'mobile', aliases: ['모바일'] },
    { canonical: 'screen', aliases: ['화면'] },
  ],
});

describe('22.3 Lock 단계 미등록 한글 단어 확인 요청', () => {
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

  const drafts: ManifestDraft[] = [
    { artifactId: 'art.mobile-app', displayName: '하네스/모바일', kind: 'dir' },
    { artifactId: 'art.payment-screen', displayName: '하네스/모바일/결제 화면', kind: 'dir' },
    { artifactId: 'art.cart', displayName: '하네스/모바일/장바구니.kt', kind: 'file' },
  ];

  it('미등록 단어 시 approval_request 이벤트, manifest는 잠기지 않음', () => {
    const { log, store } = setup();
    const r = store.lock(drafts, { glossary });
    expect(r.status).toBe('needs_approval');
    if (r.status !== 'needs_approval') return;
    expect(r.unknownWords).toEqual(['결제', '장바구니']);
    expect(r.artifacts.map((a) => a.artifactId)).toEqual(['art.payment-screen', 'art.cart']);

    const evs = log.query({ sessionId: 's1', type: 'approval_request' });
    expect(evs).toHaveLength(1);
    const ev = ApprovalRequestEventSchema.parse(evs[0]);
    expect(ev.approvalId).toBe(r.approvalId);
    expect(ev.kind).toBe('glossary.unknown-terms');
    expect(ev.title).toContain('결제');
    expect(ev.detail).toMatchObject({ words: ['결제', '장바구니'] });
    expect(existsSync(store.file)).toBe(false);
    expect(store.isLocked()).toBe(false);
  });

  it('사용자가 영문 이름을 정하면 잠금 성공 (overrides 또는 glossary 추가)', () => {
    const { log, store } = setup();
    const r = store.lock(drafts, { glossary, overrides: { 결제: 'payment', 장바구니: 'cart' } });
    expect(r.status).toBe('locked');
    if (r.status !== 'locked') return;
    expect(r.manifest.artifacts).toEqual({
      'art.mobile-app': { displayName: '하네스/모바일', path: 'harness/mobile', kind: 'dir' },
      'art.payment-screen': {
        displayName: '하네스/모바일/결제 화면',
        path: 'harness/mobile/payment-screen',
        kind: 'dir',
      },
      'art.cart': { displayName: '하네스/모바일/장바구니.kt', path: 'harness/mobile/cart.kt', kind: 'file' },
    });
    expect(store.resolve('art.cart').path).toBe('harness/mobile/cart.kt');
    expect(log.query({ type: 'approval_request' })).toHaveLength(0);
    expect(log.query({ type: 'manifest_lock' })).toHaveLength(1);

    const g2 = addTerms(glossary, { 결제: 'payment', 장바구니: 'cart' });
    const s2 = new ManifestStore({ dir: join(store.file, '..', '..', 'ws2') });
    expect(s2.lock(drafts, { glossary: g2 }).status).toBe('locked');
  });

  it('모든 단어가 glossary에 있으면 바로 잠금', () => {
    const { log, store } = setup();
    expect(store.lock([drafts[0]!], { glossary }).status).toBe('locked');
    expect(log.query({ type: 'approval_request' })).toHaveLength(0);
  });
});
