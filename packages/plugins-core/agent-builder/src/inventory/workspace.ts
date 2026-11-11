import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import type { WorkspaceContext } from './schema.js';

/**
 * P4-A.7 워크스페이스 맥락: 프로젝트 이름, AGENTS.md/CLAUDE.md 존재, 주요 언어·프레임워크 추정.
 * 파일 이름·확장자·빌드 파일 이름만 본다. 코드 본문은 읽지 않는다
 * (예외: package.json의 name과 의존성 "이름"만 — 값·스크립트는 보지 않는다).
 */

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  'target',
  '.gradle',
  '.idea',
  '.next',
  '.venv',
  'venv',
  '__pycache__',
  'Pods',
  '.harness-x',
]);

const EXT_LANG: Record<string, string> = {
  '.kt': 'Kotlin',
  '.kts': 'Kotlin',
  '.java': 'Java',
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript',
  '.js': 'JavaScript',
  '.jsx': 'JavaScript',
  '.mjs': 'JavaScript',
  '.py': 'Python',
  '.rs': 'Rust',
  '.go': 'Go',
  '.swift': 'Swift',
  '.dart': 'Dart',
  '.rb': 'Ruby',
  '.php': 'PHP',
  '.cs': 'C#',
  '.cpp': 'C++',
  '.cc': 'C++',
  '.c': 'C',
};

/** 빌드·설정 파일 이름 → [언어, 프레임워크] */
const BUILD_FILES: Record<string, { language?: string; framework?: string }> = {
  'build.gradle.kts': { language: 'Kotlin', framework: 'Gradle' },
  'build.gradle': { language: 'Java', framework: 'Gradle' },
  'settings.gradle.kts': { language: 'Kotlin', framework: 'Gradle' },
  'AndroidManifest.xml': { framework: 'Android' },
  'pom.xml': { language: 'Java', framework: 'Maven' },
  'package.json': { language: 'JavaScript', framework: 'Node.js' },
  'tsconfig.json': { language: 'TypeScript' },
  'Cargo.toml': { language: 'Rust', framework: 'Cargo' },
  'go.mod': { language: 'Go' },
  'pyproject.toml': { language: 'Python' },
  'requirements.txt': { language: 'Python' },
  'manage.py': { language: 'Python', framework: 'Django' },
  'pubspec.yaml': { language: 'Dart', framework: 'Flutter' },
  'Package.swift': { language: 'Swift', framework: 'Swift Package' },
  Podfile: { framework: 'iOS (CocoaPods)' },
  Gemfile: { language: 'Ruby' },
  'composer.json': { language: 'PHP' },
};

const CONFIG_PREFIX: [RegExp, string][] = [
  [/^next\.config\./, 'Next.js'],
  [/^vite\.config\./, 'Vite'],
  [/^nuxt\.config\./, 'Nuxt'],
  [/^svelte\.config\./, 'Svelte'],
  [/^angular\.json$/, 'Angular'],
  [/^tauri\.conf\.json$/, 'Tauri'],
];

/** package.json 의존성 이름 → 프레임워크 */
const NPM_FRAMEWORKS: Record<string, string> = {
  react: 'React',
  vue: 'Vue',
  svelte: 'Svelte',
  next: 'Next.js',
  express: 'Express',
  fastify: 'Fastify',
  electron: 'Electron',
  'react-native': 'React Native',
};

export interface WorkspaceScanOptions {
  /** 탐색 깊이 (기본 4) */
  maxDepth?: number;
  /** 최대 파일 수 (기본 5000) */
  maxFiles?: number;
}

export function guessWorkspace(root: string | undefined, opts: WorkspaceScanOptions = {}): WorkspaceContext {
  const empty: WorkspaceContext = {
    name: root ? basename(root) : '',
    hasAgentsMd: false,
    hasClaudeMd: false,
    languages: [],
    frameworks: [],
    evidence: [],
  };
  if (!root || !existsSync(root)) return empty;
  const maxDepth = opts.maxDepth ?? 4;
  const maxFiles = opts.maxFiles ?? 5000;
  const langCount = new Map<string, number>();
  const frameworks: string[] = [];
  const evidence = new Set<string>();
  const addLang = (l: string, w: number) => langCount.set(l, (langCount.get(l) ?? 0) + w);
  const addFw = (f: string) => {
    if (!frameworks.includes(f)) frameworks.push(f);
  };
  let files = 0;
  let name = basename(root);

  const walk = (dir: string, depth: number) => {
    let entries: string[];
    try {
      entries = readdirSync(dir).sort();
    } catch {
      return;
    }
    for (const e of entries) {
      if (files >= maxFiles) return;
      const full = join(dir, e);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (!SKIP_DIRS.has(e) && depth < maxDepth) walk(full, depth + 1);
        continue;
      }
      files++;
      const build = BUILD_FILES[e];
      if (build) {
        evidence.add(e);
        if (build.language) addLang(build.language, 5);
        if (build.framework) addFw(build.framework);
      }
      for (const [re, fw] of CONFIG_PREFIX)
        if (re.test(e)) {
          evidence.add(e);
          addFw(fw);
        }
      const lang = EXT_LANG[extname(e).toLowerCase()];
      if (lang) addLang(lang, 1);
    }
  };
  walk(root, 0);

  const pkg = join(root, 'package.json');
  if (existsSync(pkg)) {
    try {
      const j = JSON.parse(readFileSync(pkg, 'utf8')) as {
        name?: unknown;
        dependencies?: Record<string, unknown>;
        devDependencies?: Record<string, unknown>;
      };
      if (typeof j.name === 'string' && j.name) name = j.name;
      const deps = { ...j.dependencies, ...j.devDependencies };
      for (const [dep, fw] of Object.entries(NPM_FRAMEWORKS)) if (dep in deps) addFw(fw);
    } catch {
      // 깨진 package.json은 무시
    }
  }
  return {
    name,
    hasAgentsMd: existsSync(join(root, 'AGENTS.md')),
    hasClaudeMd: existsSync(join(root, 'CLAUDE.md')),
    languages: [...langCount.entries()].sort((a, b) => b[1] - a[1]).map(([l]) => l),
    frameworks,
    evidence: [...evidence].sort(),
  };
}
