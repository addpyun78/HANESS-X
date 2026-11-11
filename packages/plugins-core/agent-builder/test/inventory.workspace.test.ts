import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { guessWorkspace } from '../src/inventory/workspace.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function repo(name: string, files: Record<string, string>): string {
  const root = join(mkdtempSync(join(tmpdir(), 'hx-inv-ws-')), name);
  dirs.push(dirname(root));
  for (const [rel, text] of Object.entries(files)) {
    const f = join(root, rel);
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, text);
  }
  return root;
}

describe('P4-A.7 워크스페이스 맥락 추정 (테스트 저장소 3종)', () => {
  it('① Android Kotlin 앱 (build.gradle.kts → Kotlin/Android)', () => {
    const root = repo('imjang-note', {
      'AGENTS.md': '# 규칙',
      'settings.gradle.kts': '',
      'app/build.gradle.kts': '',
      'app/src/main/AndroidManifest.xml': '<manifest/>',
      'app/src/main/java/com/x/MainActivity.kt': 'class MainActivity',
      'app/src/main/java/com/x/ui/Screen.kt': 'fun Screen() {}',
      'app/src/main/java/com/x/Legacy.java': 'class Legacy {}',
    });
    const ws = guessWorkspace(root);
    expect(ws.name).toBe('imjang-note');
    expect(ws.hasAgentsMd).toBe(true);
    expect(ws.hasClaudeMd).toBe(false);
    expect(ws.languages[0]).toBe('Kotlin');
    expect(ws.frameworks).toEqual(expect.arrayContaining(['Android', 'Gradle']));
    expect(ws.evidence).toEqual(expect.arrayContaining(['build.gradle.kts', 'AndroidManifest.xml']));
  });

  it('② React + TypeScript 웹 (package.json 의존성 이름·tsconfig·vite)', () => {
    const root = repo('web-app', {
      'CLAUDE.md': '# 규칙',
      'package.json': JSON.stringify({ name: 'shop-web', dependencies: { react: '^19.0.0' } }),
      'tsconfig.json': '{}',
      'vite.config.ts': 'export default {}',
      'src/App.tsx': 'export const App = () => null',
      'src/main.tsx': '',
      'node_modules/lodash/index.js': '',
    });
    const ws = guessWorkspace(root);
    expect(ws.name).toBe('shop-web');
    expect(ws.hasClaudeMd).toBe(true);
    expect(ws.languages[0]).toBe('TypeScript');
    expect(ws.frameworks).toEqual(expect.arrayContaining(['React', 'Vite', 'Node.js']));
    expect(ws.evidence).not.toContain('index.js'); // node_modules는 건너뜀
  });

  it('③ Python 서비스 (pyproject.toml → Python)', () => {
    const root = repo('crawler', {
      'pyproject.toml': '[project]\nname = "crawler"',
      'crawler/__init__.py': '',
      'crawler/main.py': 'print(1)',
      'tests/test_main.py': '',
    });
    const ws = guessWorkspace(root);
    expect(ws.languages).toEqual(['Python']);
    expect(ws.frameworks).toEqual([]);
    expect(ws.hasAgentsMd || ws.hasClaudeMd).toBe(false);
  });

  it('파일 본문은 결과에 들어가지 않는다 · 없는 폴더는 빈 맥락', () => {
    const root = repo('secret', { 'main.py': 'API_KEY = "sk-abcdefghijklmnopqrstuvwxyz"' });
    expect(JSON.stringify(guessWorkspace(root))).not.toContain('sk-');
    expect(guessWorkspace(join(root, 'nope'))).toMatchObject({ languages: [], frameworks: [] });
    expect(guessWorkspace(undefined).name).toBe('');
  });
});
