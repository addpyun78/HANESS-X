import { describe, expect, it } from 'vitest';
import {
  RECOMMEND_REASON,
  TRUST_RULES,
  analyzeGithubRepo,
  classifyUrl,
  rankCandidates,
  recommend,
  trustLevel,
  type FetchFn,
  type InstallKind,
} from '../src/index.js';

describe('P2-C.2 주소 분류기', () => {
  const TABLE: [string, string, string?][] = [
    ['https://github.com/BurntSushi/ripgrep', 'github-repo'],
    ['https://github.com/jqlang/jq.git', 'github-repo'],
    ['https://github.com/someone/hello-plugin/tree/main', 'github-repo'],
    [
      'https://github.com/jqlang/jq/releases/download/jq-1.7.1/jq-windows-amd64.exe',
      'github-release',
      'direct-download',
    ],
    ['https://github.com/a/b/releases/download/v1/b-win-x64.zip', 'github-release', 'direct-download'],
    ['https://www.npmjs.com/package/prettier', 'npm', 'npm-cli'],
    ['https://www.npmjs.com/package/@modelcontextprotocol/server-github', 'npm', 'npm-cli'],
    ['https://www.npmjs.com/package/prettier/v/3.3.3', 'npm', 'npm-cli'],
    ['https://pypi.org/project/ruff/', 'pypi', 'python-cli'],
    ['https://pypi.org/project/yt-dlp/2026.1.1/', 'pypi', 'python-cli'],
    ['https://ollama.com/library/qwen3', 'ollama', 'ollama-model'],
    ['https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint', 'vscode', 'vscode-ext'],
    ['https://hub.docker.com/_/postgres', 'docker-hub', 'docker-image'],
    ['https://hub.docker.com/r/grafana/grafana', 'docker-hub', 'docker-image'],
    ['https://download.example.com/tool/setup-1.2.exe', 'direct-file', 'direct-download'],
    ['https://cdn.example.com/app.msi', 'direct-file', 'direct-download'],
    ['https://mcp.example.com/mcp', 'mcp-endpoint', 'mcp-remote'],
    ['https://tools.example.com/v1/sse', 'mcp-endpoint', 'mcp-remote'],
    ['https://gist.github.com/someone/0123456789abcdef', 'gist-skill', 'skill'],
    ['jqlang.jq', 'winget-id', 'winget'],
    ['Git.Git', 'winget-id', 'winget'],
    ['https://example.com/about', 'unknown'],
    ['그냥 글자', 'unknown'],
  ];
  it(`주소 ${TABLE.length}개 분류 표`, () => {
    expect(TABLE.length).toBeGreaterThanOrEqual(20);
    for (const [url, type, kind] of TABLE) {
      const c = classifyUrl(url);
      expect([url, c.type]).toEqual([url, type]);
      if (kind) expect([url, c.kind]).toEqual([url, kind]);
    }
    expect(classifyUrl('https://www.npmjs.com/package/@modelcontextprotocol/server-github').id).toBe(
      '@modelcontextprotocol/server-github',
    );
    expect(classifyUrl('https://hub.docker.com/r/grafana/grafana').id).toBe('grafana/grafana');
    expect(classifyUrl('https://github.com/jqlang/jq.git')).toMatchObject({ owner: 'jqlang', repo: 'jq' });
  });
});

/** 가짜 GitHub API (읽기만). 호출 기록으로 POST·쓰기 요청이 없음을 확인 */
function fakeGithub(
  repos: Record<string, { info: Record<string, unknown>; files: Record<string, string>; release?: unknown }>,
) {
  const calls: { url: string; method: string }[] = [];
  const f: FetchFn = async (url, init) => {
    calls.push({ url, method: init?.method ?? 'GET' });
    const m = /^https:\/\/api\.github\.com\/repos\/([^/]+)\/([^/]+)(\/.*)?$/.exec(url);
    const r = m ? repos[`${m[1]}/${m[2]}`] : undefined;
    if (!m || !r) return new Response('{}', { status: 404 });
    const rest = m[3] ?? '';
    if (rest === '') return Response.json(r.info);
    if (rest === '/contents/')
      return Response.json(Object.keys(r.files).map((name) => ({ name, type: 'file' })));
    if (rest.startsWith('/contents/')) {
      const name = rest.slice('/contents/'.length);
      return name in r.files ? new Response(r.files[name]) : new Response('', { status: 404 });
    }
    if (rest === '/releases/latest')
      return r.release ? Response.json(r.release) : new Response('{}', { status: 404 });
    return new Response('{}', { status: 404 });
  };
  return { f, calls };
}

const recent = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
const old = new Date(Date.now() - 800 * 24 * 3600 * 1000).toISOString();

describe('P2-C.3 GitHub 저장소 분석 (읽기만, 코드 실행 금지)', () => {
  const gh = fakeGithub({
    'acme/hx-plugin': {
      info: { license: { spdx_id: 'MIT' }, stargazers_count: 12, pushed_at: recent, archived: false },
      files: { 'harness-plugin.json': '{}', 'README.md': '' },
    },
    'acme/skills': {
      info: { license: { spdx_id: 'Apache-2.0' }, stargazers_count: 3, pushed_at: recent },
      files: { 'SKILL.md': '---\nname: x\n---' },
    },
    'acme/node-cli': {
      info: { license: { spdx_id: 'MIT' }, stargazers_count: 999, pushed_at: recent },
      files: {
        'package.json': JSON.stringify({
          name: 'acme-cli',
          bin: { acme: 'cli.js' },
          scripts: { postinstall: 'rm -rf /' },
        }),
      },
    },
    'acme/py-tool': {
      info: { license: null, stargazers_count: 1, pushed_at: old, archived: true },
      files: {
        'pyproject.toml':
          '[project]\nname = "acme-py"\nversion = "1"\n\n[project.scripts]\nacme-py = "acme:main"\n',
      },
    },
    'acme/rusty': {
      info: { license: { spdx_id: 'MIT' }, stargazers_count: 50, pushed_at: recent },
      files: { 'Cargo.toml': '[package]\nname = "rusty"\nversion = "0.1.0"\n', Dockerfile: 'FROM scratch' },
      release: {
        tag_name: 'v0.1.0',
        assets: [
          {
            name: 'rusty-x86_64-pc-windows-msvc.zip',
            browser_download_url:
              'https://github.com/acme/rusty/releases/download/v0.1.0/rusty-x86_64-pc-windows-msvc.zip',
          },
          {
            name: 'rusty-linux.tar.gz',
            browser_download_url: 'https://github.com/acme/rusty/releases/download/v0.1.0/rusty-linux.tar.gz',
          },
        ],
      },
    },
  });
  it('샘플 저장소 5종', async () => {
    const kinds = async (repo: string) =>
      (await analyzeGithubRepo(gh.f, 'acme', repo)).candidates.map((c) => c.kind).sort();
    expect(await kinds('hx-plugin')).toEqual(['harness-plugin']);
    expect(await kinds('skills')).toEqual(['skill']);
    expect(await kinds('node-cli')).toEqual(['npm-cli']);
    expect(await kinds('py-tool')).toEqual(['python-cli']);
    expect(await kinds('rusty')).toEqual(['cargo', 'direct-download', 'docker-image']);
    const py = await analyzeGithubRepo(gh.f, 'acme', 'py-tool');
    expect(py.meta).toMatchObject({ stars: 1, archived: true, pushedAt: old });
    expect(py.meta.license).toBeUndefined();
    expect(py.candidates[0]!.trust?.level).toBe('주의');
    const node = await analyzeGithubRepo(gh.f, 'acme', 'node-cli');
    expect(node.meta).toMatchObject({ license: 'MIT', stars: 999 });
    expect(node.candidates[0]!.target.id).toBe('acme-cli');
    const rusty = await analyzeGithubRepo(gh.f, 'acme', 'rusty');
    expect(rusty.candidates.find((c) => c.kind === 'direct-download')!.target.id).toContain(
      'windows-msvc.zip',
    );
    // 읽기만: GET 요청뿐, raw 내용은 읽기만 하고 실행하지 않는다
    expect(gh.calls.every((c) => c.method === 'GET')).toBe(true);
    await expect(analyzeGithubRepo(gh.f, 'acme', 'missing')).rejects.toThrow('찾지 못했어요');
  });
});

describe('P2-C.4 신뢰 등급 기준표', () => {
  const now = new Date('2026-11-11T00:00:00Z');
  it('공식 / 일반 / 주의', () => {
    expect(TRUST_RULES.length).toBeGreaterThanOrEqual(6);
    expect(trustLevel({ kind: 'winget', now }).level).toBe('공식');
    expect(trustLevel({ kind: 'vscode-ext', verifiedPublisher: true, now }).level).toBe('공식');
    expect(trustLevel({ kind: 'npm-cli', now }).level).toBe('일반');
    const fresh = { license: 'MIT', pushedAt: '2026-10-01T00:00:00Z', archived: false };
    expect(trustLevel({ kind: 'harness-plugin', repo: fresh, now }).level).toBe('일반');
    // 주의: 1년 이상 업데이트 없음 / 보관됨 / 라이선스 없음 / 서명 없음
    expect(
      trustLevel({ kind: 'npm-cli', repo: { ...fresh, pushedAt: '2025-10-01T00:00:00Z' }, now }),
    ).toEqual({
      level: '주의',
      reasons: ['1년 넘게 고쳐지지 않았어요.'],
    });
    expect(trustLevel({ kind: 'npm-cli', repo: { ...fresh, archived: true }, now }).level).toBe('주의');
    expect(
      trustLevel({ kind: 'npm-cli', repo: { pushedAt: fresh.pushedAt, archived: false }, now }).level,
    ).toBe('주의');
    expect(trustLevel({ kind: 'direct-download', signed: false, now }).level).toBe('주의');
    // 주의 조건은 공식보다 우선
    expect(trustLevel({ kind: 'winget', signed: false, now }).level).toBe('주의');
    // 경계: 정확히 365일은 아직 일반
    expect(
      trustLevel({ kind: 'npm-cli', repo: { ...fresh, pushedAt: '2025-11-11T00:00:00Z' }, now }).level,
    ).toBe('일반');
  });
});

describe('P2-C.5 후보 정렬 + 쉬운 말 추천 1개', () => {
  it('winget이 가장 먼저, 주의 등급은 뒤로', () => {
    const c = (kind: InstallKind, level?: '공식' | '일반' | '주의') => ({
      kind,
      ...(level ? { trust: { level, reasons: [] } } : {}),
    });
    const r = recommend([c('direct-download'), c('npm-cli'), c('winget', '공식'), c('scoop'), c('cargo')]);
    expect(r.ranked.map((x) => x.kind)).toEqual(['winget', 'scoop', 'npm-cli', 'cargo', 'direct-download']);
    expect(r.recommended?.kind).toBe('winget');
    expect(r.reason).toBe('winget이 가장 안전하고 지우기도 쉬워요.');
    expect(rankCandidates([c('winget', '주의'), c('npm-cli', '일반')]).map((x) => x.kind)).toEqual([
      'npm-cli',
      'winget',
    ]);
    expect(recommend([]).recommended).toBeUndefined();
    for (const reason of Object.values(RECOMMEND_REASON)) {
      expect(reason).toMatch(/요\.$/);
      for (const sentence of reason!.split('. ')) expect(sentence.length).toBeLessThanOrEqual(45);
    }
  });
});
