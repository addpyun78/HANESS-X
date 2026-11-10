import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  ChecklistItemSchema,
  ChecklistSchema,
  parseItem,
  type ChecklistItem,
  type ItemStatus,
} from '../src/schema.js';
import { item } from './helpers.js';

describe('20.1 항목 스키마', () => {
  it('필수 필드만 주면 기본값이 채워진다', () => {
    const it1 = parseItem(item('1'));
    expect(it1).toMatchObject({
      id: '1',
      parent: null,
      owner: null,
      deps: [],
      status: 'todo',
      attempts: 0,
      evidence: [],
    });
    expect(it1.verdict).toBeUndefined();
    expectTypeOf(it1).toEqualTypeOf<ChecklistItem>();
    expectTypeOf(it1.status).toEqualTypeOf<ItemStatus>();
  });

  it('전체 필드 (verdict 포함) 통과', () => {
    const full = parseItem({
      id: '1.2',
      parent: '1',
      title: '로그인 화면 작성',
      owner: 'claude-code',
      deps: ['1.1'],
      artifactId: 'art.mobile-app',
      acceptance: [
        { type: 'test', run: 'pnpm test login' },
        { type: 'symbol', symbol: 'LoginScreen', file: 'src/login.kt' },
        { type: 'file_exists' },
        { type: 'schema', file: 'app.json', requiredKeys: ['name'] },
        { type: 'command', run: 'test -d {path}', expectExit: 0 },
        { type: 'llm', prompt: '디자인과 일치?' },
      ],
      status: 'verifying',
      attempts: 2,
      evidence: [{ kind: 'command', summary: 'exit 0', ts: '2026-11-10T00:00:00.000Z', extra: 1 }],
      verdict: { level: 2, verdict: 'equal', confidence: 1, reason: 'glossary' },
      estimate: { files: 1, diffLines: 40 },
    });
    expect(full.acceptance).toHaveLength(6);
    expect(full.evidence[0]).toHaveProperty('extra', 1);
  });

  it.each([
    ['id 누락', { id: undefined }],
    ['빈 제목', { title: '   ' }],
    ['artifactId 형식', { artifactId: 'Art Mobile' }],
    ['acceptance 비어 있음', { acceptance: [] }],
    ['알 수 없는 acceptance 타입', { acceptance: [{ type: 'magic' }] }],
    ['알 수 없는 상태', { status: 'finished' }],
    ['attempts 음수', { attempts: -1 }],
    ['verdict 범위 밖', { verdict: { level: 6, verdict: 'equal', confidence: 1, reason: '' } }],
    ['verdict 종류', { verdict: { level: 1, verdict: 'same', confidence: 1, reason: '' } }],
    ['confidence > 1', { verdict: { level: 1, verdict: 'equal', confidence: 1.5, reason: '' } }],
    ['evidence kind 누락', { evidence: [{ summary: 'x' }] }],
    ['자기 자신 parent', { parent: '1' }],
    ['자기 자신 dep', { deps: ['1'] }],
    ['모르는 필드', { foo: 1 }],
  ])('거부: %s', (_name, patch) => {
    expect(ChecklistItemSchema.safeParse({ ...item('1'), ...patch }).success).toBe(false);
  });

  it('체크리스트 문서: 중복 id·없는 parent/dep 거부', () => {
    const base = { schemaVersion: 1, revision: 1, version: 1, updatedAt: '2026-11-10T00:00:00.000Z' };
    expect(
      ChecklistSchema.safeParse({ ...base, items: [item('1'), item('2', { deps: ['1'] })] }).success,
    ).toBe(true);
    expect(ChecklistSchema.safeParse({ ...base, items: [item('1'), item('1')] }).success).toBe(false);
    expect(ChecklistSchema.safeParse({ ...base, items: [item('2', { parent: '9' })] }).success).toBe(false);
    expect(ChecklistSchema.safeParse({ ...base, items: [item('2', { deps: ['9'] })] }).success).toBe(false);
  });
});
