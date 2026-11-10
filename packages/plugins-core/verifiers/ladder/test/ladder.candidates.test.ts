import { loadDefaultGlossary } from '@harness-x/checklist-ledger';
import { describe, expect, it } from 'vitest';
import { collectCandidates, editDistance, type FileChangeLike } from '../src/candidates.js';

const glossary = loadDefaultGlossary();

describe('25.3 L3 후보 수집', () => {
  it('편집거리', () => {
    expect(editDistance('mobile', 'mobile')).toBe(0);
    expect(editDistance('mobile', 'mobil')).toBe(1);
    expect(editDistance('kitten', 'sitting')).toBe(3);
    expect(editDistance('하네스', '하내스')).toBe(1);
  });

  it('파일: 확장자 일치 우선 → basename 편집거리 오름차순, 상위 5개', () => {
    const changes: FileChangeLike[] = [
      { path: 'src/LoginView.kt', change: 'create' },
      { path: 'src/login-screen.java', change: 'create' },
      { path: 'ai/mobile/LoginScreen.kt', change: 'create' },
      { path: 'ai/mobile/LoginScren.kt', change: 'modify' },
      { path: 'README.md', change: 'modify' },
      { path: 'gone/login-screen.kt', change: 'delete' },
      { path: 'x/settings.kt', change: 'create' },
      { path: 'x/a.kt', change: 'create' },
      { path: 'x/b.kt', change: 'create' },
    ];
    const c = collectCandidates('하네스/모바일/로그인화면.kt', changes, { kind: 'file', glossary });
    expect(c.map((x) => x.path)).toEqual([
      'ai/mobile/LoginScreen.kt',
      'ai/mobile/LoginScren.kt',
      'src/LoginView.kt',
      'x/settings.kt',
      'x/a.kt',
    ]);
    expect(c[0]).toMatchObject({ distance: 0, similarity: 1, extMatch: true });
    expect(c.every((x) => x.extMatch)).toBe(true);
    expect(c.map((x) => x.distance)).toEqual([...c.map((x) => x.distance)].sort((a, b) => a - b));
    // 삭제된 파일은 후보가 아니다
    expect(c.some((x) => x.path.startsWith('gone/'))).toBe(false);
  });

  it('디렉터리: 변경 파일의 상위 폴더가 후보, root 기준 상대 경로', () => {
    const changes = [
      '/ws/ai/mobile/MainActivity.kt',
      '/ws/ai/mobile/ui/Login.kt',
      '/ws/ai/web/index.ts',
      '/ws/docs/mobile.md',
    ];
    const c = collectCandidates('하네스/모바일', changes, { kind: 'dir', glossary, root: '/ws' });
    expect(c[0]).toMatchObject({ path: 'ai/mobile', distance: 0, hits: 2 });
    expect(c.map((x) => x.path)).toEqual(['ai/mobile', 'ai', 'docs', 'ai/web', 'ai/mobile/ui']);
  });

  it('limit 설정, 동점은 경로 순으로 결정적', () => {
    const changes = ['b/x.ts', 'a/x.ts', 'c/x.ts'];
    const c1 = collectCandidates('x.ts', changes, { kind: 'file', glossary, limit: 2 });
    const c2 = collectCandidates('x.ts', [...changes].reverse(), { kind: 'file', glossary, limit: 2 });
    expect(c1.map((x) => x.path)).toEqual(['a/x.ts', 'b/x.ts']);
    expect(c2).toEqual(c1);
  });
});
