import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadDefaultGlossary, type Manifest } from '@harness-x/checklist-ledger';
import { matchManifestPath } from '../src/index.js';

// 24.3 쓰기 대상 경로를 정규화 + glossary로 manifest에 매칭
const glossary = loadDefaultGlossary();
const ws = '/work/proj';
const manifest: Manifest = {
  schemaVersion: 1,
  revision: 1,
  locked: true,
  digest: '0'.repeat(64),
  artifacts: {
    'art.mobile-app': { displayName: '하네스/모바일', path: 'harness/mobile', kind: 'dir' },
    'art.agent-settings': { displayName: '에이전트 설정.json', path: 'agent-settings.json', kind: 'file' },
    'art.legacy': { displayName: 'ai 모바일', path: 'ai-mobile', kind: 'dir', aliases: ['ai/mobile'] },
  },
};
const m = (p: string, cwd = ws) => matchManifestPath(p, manifest, { workspace: ws, cwd, glossary });

describe('24.3 matchManifestPath', () => {
  it('하네스/모바일/a.kt → harness/mobile/a.kt (L2)', () => {
    expect(m('하네스/모바일/a.kt')).toEqual({
      kind: 'corrected',
      artifactId: 'art.mobile-app',
      path: '하네스/모바일/a.kt',
      canonical: 'harness/mobile/a.kt',
      level: 2,
    });
  });

  it('NFD 한글·역슬래시·절대 경로도 같은 결과', () => {
    expect(m('하네스\\모바일\\a.kt'.normalize('NFD'))).toMatchObject({
      kind: 'corrected',
      canonical: 'harness/mobile/a.kt',
    });
    expect(m(join(ws, '하네스/모바일/화면/a.kt'))).toMatchObject({
      kind: 'corrected',
      canonical: 'harness/mobile/screen/a.kt',
    });
    expect(m('Harness/Mobile/MainActivity.kt')).toMatchObject({
      kind: 'corrected',
      canonical: 'harness/mobile/MainActivity.kt',
    });
    expect(m('에이전트 설정.json')).toMatchObject({ kind: 'corrected', canonical: 'agent-settings.json' });
  });

  it('정식 경로(L1 정규화 후 같음)는 exact', () => {
    expect(m('harness/mobile/a.kt')).toMatchObject({ kind: 'exact', artifactId: 'art.mobile-app' });
    expect(m('./harness//mobile/sub/../a.kt')).toMatchObject({
      kind: 'exact',
      canonical: 'harness/mobile/a.kt',
    });
    expect(m('a.kt', join(ws, 'harness/mobile'))).toMatchObject({ kind: 'exact' });
    expect(m(join(ws, 'agent-settings.json'))).toMatchObject({
      kind: 'exact',
      artifactId: 'art.agent-settings',
    });
  });

  it('동치로 인정된 별칭 경로는 정식 경로로 교정 (L1)', () => {
    expect(m('ai/mobile/x.kt')).toMatchObject({ kind: 'corrected', canonical: 'ai-mobile/x.kt', level: 1 });
  });

  it('manifest 밖 / 워크스페이스 밖', () => {
    expect(m('src/other.ts')).toMatchObject({ kind: 'outside', reason: 'not_in_manifest' });
    expect(m('harness/mobile-old/a.kt')).toMatchObject({ kind: 'outside' });
    expect(m('/etc/passwd')).toMatchObject({ kind: 'outside', reason: 'outside_workspace' });
    expect(m('../x.txt')).toMatchObject({ kind: 'outside', reason: 'outside_workspace' });
  });
});
