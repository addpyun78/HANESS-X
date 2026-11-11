import type { InstallTarget } from './adapter.js';
import type { InstallKind } from './plan.js';

/**
 * 주소로 설치 (P2-C)
 *  C.2 주소 분류기, C.3 GitHub 저장소 분석(읽기만 — 코드 실행 금지), C.4 신뢰 등급, C.5 후보 정렬·추천
 */

// ── C.2 주소 분류 ────────────────────────────────────────────
export const URL_TYPES = [
  'github-repo',
  'github-release',
  'npm',
  'pypi',
  'ollama',
  'vscode',
  'docker-hub',
  'direct-file',
  'mcp-endpoint',
  'gist-skill',
  'winget-id',
  'unknown',
] as const;
export type UrlType = (typeof URL_TYPES)[number];

export interface UrlClass {
  type: UrlType;
  /** 바로 설치할 수 있으면 종류 (github-repo·gist는 분석 후 결정) */
  kind?: InstallKind;
  /** 패키지 식별자 */
  id?: string;
  owner?: string;
  repo?: string;
  version?: string;
  url?: string;
}

const WINGET_ID_RE = /^[A-Za-z0-9][\w-]*(\.[A-Za-z0-9][\w+-]*)+$/;

export function classifyUrl(input: string): UrlClass {
  const s = input.trim();
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    // 주소가 아니면 winget id 형태인지 (예: jqlang.jq, Git.Git)
    if (WINGET_ID_RE.test(s) && !/\.(exe|msi|zip|com|org|io|net|dev)$/i.test(s))
      return { type: 'winget-id', kind: 'winget', id: s };
    return { type: 'unknown' };
  }
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return { type: 'unknown' };
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  const parts = u.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const url = u.href;

  if (host === 'github.com' && parts.length >= 2) {
    const [owner, repo] = [parts[0]!, parts[1]!.replace(/\.git$/, '')];
    if (parts[2] === 'releases' && parts[3] === 'download' && parts.length >= 6)
      return {
        type: 'github-release',
        kind: 'direct-download',
        id: url,
        owner,
        repo,
        version: parts[4]!,
        url,
      };
    return { type: 'github-repo', owner, repo, url: `https://github.com/${owner}/${repo}` };
  }
  if (host === 'gist.github.com' && parts.length >= 1)
    return { type: 'gist-skill', kind: 'skill', id: parts[parts.length - 1]!, url };
  if (host === 'npmjs.com' && parts[0] === 'package') {
    const name = parts[1]?.startsWith('@') ? `${parts[1]}/${parts[2]}` : parts[1];
    const rest = parts.slice(parts[1]?.startsWith('@') ? 3 : 2);
    return {
      type: 'npm',
      kind: 'npm-cli',
      id: name!,
      ...(rest[0] === 'v' && rest[1] ? { version: rest[1] } : {}),
      url,
    };
  }
  if (host === 'pypi.org' && parts[0] === 'project' && parts[1])
    return {
      type: 'pypi',
      kind: 'python-cli',
      id: parts[1],
      ...(parts[2] ? { version: parts[2] } : {}),
      url,
    };
  if (host === 'ollama.com' && parts[0] === 'library' && parts[1])
    return { type: 'ollama', kind: 'ollama-model', id: parts[1], url };
  if (host === 'marketplace.visualstudio.com') {
    const item = u.searchParams.get('itemName');
    if (item) return { type: 'vscode', kind: 'vscode-ext', id: item, url };
  }
  if (host === 'hub.docker.com') {
    if (parts[0] === '_' && parts[1]) return { type: 'docker-hub', kind: 'docker-image', id: parts[1], url };
    if ((parts[0] === 'r' || parts[0] === 'repository') && parts.length >= 3)
      return {
        type: 'docker-hub',
        kind: 'docker-image',
        id: `${parts[parts.length - 2]}/${parts[parts.length - 1]}`,
        url,
      };
  }
  if (/\.(exe|msi|zip)$/i.test(u.pathname))
    return { type: 'direct-file', kind: 'direct-download', id: url, url };
  if (/\/(mcp|sse)\/?$/i.test(u.pathname)) return { type: 'mcp-endpoint', kind: 'mcp-remote', id: url, url };
  return { type: 'unknown', url };
}

// ── C.3 GitHub 저장소 분석 (읽기만) ─────────────────────────
export interface RepoMeta {
  owner: string;
  repo: string;
  url: string;
  license?: string;
  stars: number;
  pushedAt?: string;
  archived: boolean;
  description?: string;
}

export interface Candidate {
  kind: InstallKind;
  target: InstallTarget;
  /** 쉬운 말 설명 */
  label: string;
  source: string;
  trust?: TrustResult;
}

export interface RepoAnalysis {
  meta: RepoMeta;
  candidates: Candidate[];
  files: string[];
}

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

const GH_API = 'https://api.github.com';

async function getJson<T>(f: FetchFn, url: string): Promise<T | undefined> {
  const res = await f(url, { headers: { accept: 'application/vnd.github+json' } });
  if (!res.ok) return undefined;
  return (await res.json()) as T;
}

async function getRaw(f: FetchFn, owner: string, repo: string, path: string): Promise<string | undefined> {
  const res = await f(`${GH_API}/repos/${owner}/${repo}/contents/${path}`, {
    headers: { accept: 'application/vnd.github.raw' },
  });
  return res.ok ? res.text() : undefined;
}

/** pyproject.toml에서 [project] name·[project.scripts] 존재 확인 (간단 해석) */
export function parsePyproject(text: string): { name?: string; scripts: string[] } {
  const name = /^\s*\[project\][^[]*?^\s*name\s*=\s*["']([^"']+)["']/ms.exec(text)?.[1];
  const sec = /^\s*\[project\.scripts\]\s*$([\s\S]*?)(^\s*\[|$(?![\s\S]))/m.exec(text)?.[1] ?? '';
  const scripts = [...sec.matchAll(/^\s*([\w.-]+)\s*=/gm)].map((m) => m[1]!);
  return { ...(name ? { name } : {}), scripts };
}

export function parseCargoToml(text: string): { name?: string } {
  const name = /^\s*\[package\][^[]*?^\s*name\s*=\s*["']([^"']+)["']/ms.exec(text)?.[1];
  return name ? { name } : {};
}

export async function analyzeGithubRepo(f: FetchFn, owner: string, repo: string): Promise<RepoAnalysis> {
  const info = await getJson<{
    html_url?: string;
    license?: { spdx_id?: string } | null;
    stargazers_count?: number;
    pushed_at?: string;
    archived?: boolean;
    description?: string;
  }>(f, `${GH_API}/repos/${owner}/${repo}`);
  if (!info) throw Object.assign(new Error('저장소를 찾지 못했어요.'), { code: 'NOT_FOUND' });
  const url = info.html_url ?? `https://github.com/${owner}/${repo}`;
  const lic = info.license?.spdx_id;
  const meta: RepoMeta = {
    owner,
    repo,
    url,
    ...(lic && lic !== 'NOASSERTION' ? { license: lic } : {}),
    stars: info.stargazers_count ?? 0,
    ...(info.pushed_at ? { pushedAt: info.pushed_at } : {}),
    archived: Boolean(info.archived),
    ...(info.description ? { description: info.description } : {}),
  };
  const listing =
    (await getJson<{ name: string; type: string }[]>(f, `${GH_API}/repos/${owner}/${repo}/contents/`)) ?? [];
  const files = listing.map((x) => x.name);
  const has = (n: string) => files.includes(n);
  const cands: Candidate[] = [];
  const src = url;

  if (has('harness-plugin.json'))
    cands.push({
      kind: 'harness-plugin',
      target: { id: url, name: repo },
      label: '하네스 플러그인',
      source: src,
    });
  if (has('SKILL.md'))
    cands.push({ kind: 'skill', target: { id: url, name: repo }, label: '스킬', source: src });
  if (has('package.json')) {
    const raw = await getRaw(f, owner, repo, 'package.json');
    try {
      const pkg = raw ? (JSON.parse(raw) as { name?: string; bin?: unknown; private?: boolean }) : undefined;
      if (pkg?.name && pkg.bin && !pkg.private)
        cands.push({
          kind: 'npm-cli',
          target: { id: pkg.name },
          label: `npm 명령줄 도구 ${pkg.name}`,
          source: src,
        });
      if (pkg?.name && /mcp/i.test(`${pkg.name} ${repo}`) && !pkg.private)
        cands.push({
          kind: 'mcp-local',
          target: { id: pkg.name },
          label: `MCP 서버 ${pkg.name}`,
          source: src,
        });
    } catch {
      /* 깨진 package.json은 무시 */
    }
  }
  if (has('pyproject.toml')) {
    const raw = await getRaw(f, owner, repo, 'pyproject.toml');
    const py = raw ? parsePyproject(raw) : { scripts: [] };
    if (py.name && py.scripts.length)
      cands.push({
        kind: 'python-cli',
        target: { id: py.name },
        label: `Python 명령줄 도구 ${py.name}`,
        source: src,
      });
  }
  if (has('Cargo.toml')) {
    const raw = await getRaw(f, owner, repo, 'Cargo.toml');
    const c = raw ? parseCargoToml(raw) : {};
    if (c.name)
      cands.push({ kind: 'cargo', target: { id: c.name }, label: `Rust 도구 ${c.name}`, source: src });
  }
  if (has('Dockerfile'))
    cands.push({
      kind: 'docker-image',
      target: { id: `${owner}/${repo}`.toLowerCase() },
      label: 'Docker 이미지 (게시된 이미지가 있을 때만)',
      source: src,
    });
  const rel = await getJson<{ tag_name?: string; assets?: { name: string; browser_download_url: string }[] }>(
    f,
    `${GH_API}/repos/${owner}/${repo}/releases/latest`,
  );
  for (const a of rel?.assets ?? [])
    if (/\.(exe|msi|zip)$/i.test(a.name) && /(win|windows|x64|amd64|\.exe$|\.msi$)/i.test(a.name))
      cands.push({
        kind: 'direct-download',
        target: {
          id: a.browser_download_url,
          name: a.name,
          ...(rel?.tag_name ? { version: rel.tag_name } : {}),
          options: { officialDomains: ['github.com', 'githubusercontent.com'] },
        },
        label: `Windows 설치 파일 ${a.name}`,
        source: src,
      });
  for (const c of cands) c.trust = trustLevel({ kind: c.kind, repo: meta });
  return { meta, candidates: cands, files };
}

// ── C.4 신뢰 등급 ────────────────────────────────────────────
export const TRUST_LEVEL_NAMES = ['공식', '일반', '주의'] as const;
export type TrustLevelName = (typeof TRUST_LEVEL_NAMES)[number];

export interface TrustInput {
  kind: InstallKind;
  /** 검증된 게시자 (winget 원본, 마켓의 인증 게시자, Docker 공식 이미지 등) */
  verifiedPublisher?: boolean;
  repo?: Pick<RepoMeta, 'license' | 'pushedAt' | 'archived'>;
  /** direct-download 서명 상태 */
  signed?: boolean;
  now?: Date;
}

export interface TrustResult {
  level: TrustLevelName;
  reasons: string[];
}

/** 기준표: 위에서부터 '주의' 조건 → '공식' 조건 → 나머지 '일반' */
export const TRUST_RULES: { level: TrustLevelName; reason: string; test: (i: TrustInput) => boolean }[] = [
  {
    level: '주의',
    reason: '1년 넘게 고쳐지지 않았어요.',
    test: (i) =>
      Boolean(i.repo?.pushedAt) &&
      (i.now ?? new Date()).getTime() - new Date(i.repo!.pushedAt!).getTime() > 365 * 24 * 3600 * 1000,
  },
  {
    level: '주의',
    reason: '만든 사람이 더 이상 관리하지 않아요(보관됨).',
    test: (i) => i.repo?.archived === true,
  },
  {
    level: '주의',
    reason: '사용 조건(라이선스)이 없어요.',
    test: (i) => Boolean(i.repo) && !i.repo!.license,
  },
  { level: '주의', reason: '믿을 수 있는 서명이 없어요.', test: (i) => i.signed === false },
  { level: '공식', reason: 'Windows 공식 앱 저장소예요.', test: (i) => i.kind === 'winget' },
  {
    level: '공식',
    reason: '공식 마켓의 확인된 게시자예요.',
    test: (i) => i.verifiedPublisher === true,
  },
];

export function trustLevel(i: TrustInput): TrustResult {
  const caution = TRUST_RULES.filter((r) => r.level === '주의' && r.test(i)).map((r) => r.reason);
  if (caution.length) return { level: '주의', reasons: caution };
  const official = TRUST_RULES.filter((r) => r.level === '공식' && r.test(i)).map((r) => r.reason);
  if (official.length) return { level: '공식', reasons: official };
  return { level: '일반', reasons: [] };
}

// ── C.5 후보 정렬·추천 ───────────────────────────────────────
/** 안전하고 지우기 쉬운 순서 */
export const KIND_PREFERENCE: InstallKind[] = [
  'winget',
  'scoop',
  'vscode-ext',
  'ollama-model',
  'npm-cli',
  'python-cli',
  'mcp-local',
  'mcp-remote',
  'harness-plugin',
  'skill',
  'docker-image',
  'wsl-apt',
  'cargo',
  'go',
  'choco',
  'api-service',
  'direct-download',
];

export const RECOMMEND_REASON: Partial<Record<InstallKind, string>> = {
  winget: 'winget이 가장 안전하고 지우기도 쉬워요.',
  scoop: 'scoop은 관리자 권한 없이 설치하고 지우기 쉬워요.',
  'vscode-ext': 'VS Code 공식 마켓에서 받아서 안전하고 지우기 쉬워요.',
  'ollama-model': 'Ollama 공식 목록에서 받아서 지우기도 쉬워요.',
  'npm-cli': '버전을 고정해서 설치하고 한 줄로 지울 수 있어요.',
  'python-cli': '따로 떨어진 공간에 설치해서 다른 프로그램과 섞이지 않아요.',
  'mcp-local': '프로그램을 깔지 않고 연결만 해서 빼기도 쉬워요.',
  'mcp-remote': '주소만 등록해서 빼기도 쉬워요.',
  'harness-plugin': '따로 떨어진 공간에서만 돌아가서 비교적 안전해요.',
  skill: '설명 파일만 추가돼서 비교적 안전해요.',
  'docker-image': '컨테이너 안에서만 돌아가서 컴퓨터와 섞이지 않아요.',
  cargo: '소스에서 직접 만들어 설치해요. 시간이 좀 걸려요.',
  go: '소스에서 직접 만들어 설치해요. 시간이 좀 걸려요.',
  'direct-download': '공식 설치 파일이에요. 설치 화면은 직접 진행해 주세요.',
};

const TRUST_ORDER: Record<TrustLevelName, number> = { 공식: 0, 일반: 1, 주의: 2 };

export function rankCandidates<T extends { kind: InstallKind; trust?: TrustResult }>(cands: T[]): T[] {
  return [...cands].sort((a, b) => {
    const t = TRUST_ORDER[a.trust?.level ?? '일반'] - TRUST_ORDER[b.trust?.level ?? '일반'];
    if (t) return t;
    return KIND_PREFERENCE.indexOf(a.kind) - KIND_PREFERENCE.indexOf(b.kind);
  });
}

export function recommend<T extends { kind: InstallKind; trust?: TrustResult }>(
  cands: T[],
): { ranked: T[]; recommended?: T; reason?: string } {
  const ranked = rankCandidates(cands);
  const top = ranked[0];
  if (!top) return { ranked };
  return {
    ranked,
    recommended: top,
    reason: RECOMMEND_REASON[top.kind] ?? '가장 안전한 방법을 골랐어요.',
  };
}
