import { describe, expect, it } from 'vitest';
import {
  CanonicalPathSchema,
  ManifestArtifactsSchema,
  ManifestSchema,
  manifestDigest,
} from '../src/manifest.js';

describe('22.1 manifest.json 스키마', () => {
  const artifacts = {
    'art.mobile-app': { displayName: '하네스/모바일', path: 'harness/mobile', kind: 'dir' },
    'art.login-screen': { displayName: '로그인 화면', path: 'harness/mobile/login-screen.kt', kind: 'file' },
  };

  it('{artifactId: {displayName, path, kind}} 통과', () => {
    expect(ManifestArtifactsSchema.parse(artifacts)).toEqual(artifacts);
    const m = ManifestSchema.parse({
      schemaVersion: 1,
      revision: 1,
      locked: true,
      lockedAt: '2026-11-10T00:00:00.000Z',
      digest: manifestDigest(artifacts as never),
      artifacts,
    });
    expect(Object.keys(m.artifacts)).toEqual(['art.mobile-app', 'art.login-screen']);
  });

  it.each([
    ['artifactId 형식', { 'Art Mobile': artifacts['art.mobile-app'] }],
    ['kind 값', { 'art.x': { displayName: 'x', path: 'x', kind: 'folder' } }],
    ['displayName 비어 있음', { 'art.x': { displayName: ' ', path: 'x', kind: 'dir' } }],
    ['한글 경로', { 'art.x': { displayName: 'x', path: '하네스/모바일', kind: 'dir' } }],
    ['대문자 경로', { 'art.x': { displayName: 'x', path: 'Harness/Mobile', kind: 'dir' } }],
    ['모르는 필드', { 'art.x': { displayName: 'x', path: 'x', kind: 'dir', foo: 1 } }],
  ])('거부: %s', (_n, a) => {
    expect(ManifestArtifactsSchema.safeParse(a).success).toBe(false);
  });

  it('정식 경로 규칙', () => {
    for (const ok of ['harness/mobile', 'a/b-c/d.kt', 'src/index.test.ts', '.github/workflows'])
      expect(CanonicalPathSchema.safeParse(ok).success, ok).toBe(true);
    for (const bad of ['/abs/path', 'a//b', 'a/../b', 'a\\b', 'a b', 'harness/mobile/', 'C:/x'])
      expect(CanonicalPathSchema.safeParse(bad).success, bad).toBe(false);
  });

  it('잠긴 manifest는 digest 필수, 경로 중복 거부', () => {
    const base = { schemaVersion: 1, revision: 1, artifacts };
    expect(ManifestSchema.safeParse({ ...base, locked: true }).success).toBe(false);
    expect(ManifestSchema.safeParse({ ...base, locked: false }).success).toBe(true);
    const dup = {
      'art.a': { displayName: 'a', path: 'same', kind: 'dir' },
      'art.b': { displayName: 'b', path: 'same', kind: 'dir' },
    };
    expect(ManifestSchema.safeParse({ ...base, locked: false, artifacts: dup }).success).toBe(false);
  });
});
