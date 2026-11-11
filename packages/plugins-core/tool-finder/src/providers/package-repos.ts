import { parseWingetShow, parseWingetTable } from '@harness-x/installer';
import { assertSafeQuery } from '../sanitize.js';
import type { FetchLike, RawHit, SearchProvider } from './types.js';

/**
 * P3-B.1 ① 패키지 저장소 검색 (무료·구조화·신뢰): winget / npm / PyPI / Ollama 라이브러리 / MCP 레지스트리.
 * 모든 외부 호출은 주입된 runner·fetch로만 (테스트는 모킹). 결과는 저장소당 최대 5개.
 */

const PER_PROVIDER = 5;
/** 라이선스까지 자세히 읽는 결과 수 */
const DETAIL = 3;

async function getJson<T>(f: FetchLike, url: string, signal?: AbortSignal): Promise<T | undefined> {
  try {
    const res = await f(url, { headers: { accept: 'application/json' }, ...(signal ? { signal } : {}) });
    if (!res.ok) return undefined;
    return (await res.json()) as T;
  } catch {
    return undefined;
  }
}

async function getText(f: FetchLike, url: string, signal?: AbortSignal): Promise<string | undefined> {
  try {
    const res = await f(url, { headers: { accept: 'text/html' }, ...(signal ? { signal } : {}) });
    return res.ok ? await res.text() : undefined;
  } catch {
    return undefined;
  }
}

const enc = encodeURIComponent;

function htmlText(s: string): string {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// ── winget ───────────────────────────────────────────────────
/** winget id(Publisher.Name) → winget-pkgs 매니페스트 주소 */
export function wingetManifestUrl(id: string): string {
  const parts = id.split('.');
  return `https://github.com/microsoft/winget-pkgs/tree/master/manifests/${id[0]!.toLowerCase()}/${parts.join('/')}`;
}

export const wingetProvider: SearchProvider = {
  id: 'winget',
  kind: 'package',
  label: 'Windows 공식 앱 저장소',
  available: (ctx) => Boolean(ctx.runner),
  async search(query, ctx) {
    const q = assertSafeQuery(query);
    const r = await ctx.runner!(
      { file: 'winget', args: ['search', q, '--accept-source-agreements'], host: 'windows' },
      { timeoutMs: 60_000, ...(ctx.signal ? { signal: ctx.signal } : {}) },
    );
    if (r.code !== 0) return [];
    const rows = parseWingetTable(r.stdout).filter((x) => x.id && x.name);
    const out: RawHit[] = [];
    for (const [i, row] of rows.slice(0, PER_PROVIDER).entries()) {
      let show;
      if (i < DETAIL) {
        const s = await ctx.runner!(
          {
            file: 'winget',
            args: ['show', '--id', row.id!, '-e', '--accept-source-agreements'],
            host: 'windows',
          },
          { timeoutMs: 60_000 },
        );
        if (s.code === 0) show = parseWingetShow(s.stdout);
      }
      out.push({
        providerId: 'winget',
        name: row.name!,
        summary: show?.description ?? '',
        officialUrl: show?.homepage ?? '',
        sourceUrl: wingetManifestUrl(row.id!),
        packageRepo: true,
        ...(show?.license ? { license: show.license } : {}),
        installMethod: { kind: 'winget', id: row.id!, label: 'Windows 공식 앱 저장소' },
        os: ['windows'],
        verifiedPublisher: true,
      });
    }
    return out;
  },
};

// ── npm ──────────────────────────────────────────────────────
interface NpmSearch {
  objects: {
    package: {
      name: string;
      description?: string;
      version?: string;
      date?: string;
      license?: string;
      links?: { npm?: string; homepage?: string; repository?: string };
    };
  }[];
}

export const npmProvider: SearchProvider = {
  id: 'npm',
  kind: 'package',
  label: 'npm 저장소',
  available: (ctx) => Boolean(ctx.fetch),
  async search(query, ctx) {
    const q = assertSafeQuery(query);
    const f = ctx.fetch!;
    const r = await getJson<NpmSearch>(
      f,
      `https://registry.npmjs.org/-/v1/search?text=${enc(q)}&size=${PER_PROVIDER}`,
      ctx.signal,
    );
    const out: RawHit[] = [];
    for (const [i, { package: p }] of (r?.objects ?? []).slice(0, PER_PROVIDER).entries()) {
      let license = p.license;
      if (!license && i < DETAIL) {
        const latest = await getJson<{ license?: string }>(
          f,
          `https://registry.npmjs.org/${enc(p.name)}/latest`,
          ctx.signal,
        );
        license = typeof latest?.license === 'string' ? latest.license : undefined;
      }
      out.push({
        providerId: 'npm',
        name: p.name,
        summary: p.description ?? '',
        officialUrl: p.links?.homepage ?? p.links?.repository ?? '',
        sourceUrl: p.links?.npm ?? `https://www.npmjs.com/package/${p.name}`,
        packageRepo: true,
        ...(license ? { license } : {}),
        installMethod: { kind: 'npm-cli', id: p.name, label: 'npm 명령줄 도구' },
        os: ['windows', 'linux', 'mac'],
        ...(p.date ? { lastRelease: p.date } : {}),
      });
    }
    return out;
  },
};

// ── PyPI ─────────────────────────────────────────────────────
interface PypiJson {
  info: {
    name: string;
    summary?: string;
    license?: string | null;
    license_expression?: string | null;
    home_page?: string | null;
    project_urls?: Record<string, string> | null;
    classifiers?: string[];
  };
  urls?: { upload_time_iso_8601?: string }[];
}

const CLASSIFIER_SPDX: Record<string, string> = {
  'MIT License': 'MIT',
  'Apache Software License': 'Apache-2.0',
  'BSD License': 'BSD-3-Clause',
  'ISC License (ISCL)': 'ISC',
  'GNU General Public License v3 (GPLv3)': 'GPL-3.0',
  'GNU General Public License v2 (GPLv2)': 'GPL-2.0',
  'GNU Lesser General Public License v3 (LGPLv3)': 'LGPL-3.0',
  'Mozilla Public License 2.0 (MPL 2.0)': 'MPL-2.0',
};

export function pypiLicense(info: PypiJson['info']): string | undefined {
  if (info.license_expression) return info.license_expression;
  for (const c of info.classifiers ?? []) {
    const m = /^License :: OSI Approved :: (.+)$/.exec(c);
    if (m && CLASSIFIER_SPDX[m[1]!]) return CLASSIFIER_SPDX[m[1]!];
  }
  const l = info.license?.trim();
  return l && l.length <= 20 ? l : undefined;
}

export function parsePypiSearch(html: string): { name: string; summary: string }[] {
  const out: { name: string; summary: string }[] = [];
  const re =
    /<span class="package-snippet__name">([^<]+)<\/span>[\s\S]*?<p class="package-snippet__description">([\s\S]*?)<\/p>/g;
  for (const m of html.matchAll(re)) out.push({ name: htmlText(m[1]!), summary: htmlText(m[2]!) });
  return out;
}

export const pypiProvider: SearchProvider = {
  id: 'pypi',
  kind: 'package',
  label: 'PyPI(파이썬 저장소)',
  available: (ctx) => Boolean(ctx.fetch),
  async search(query, ctx) {
    const q = assertSafeQuery(query);
    const f = ctx.fetch!;
    const html = await getText(f, `https://pypi.org/search/?q=${enc(q)}`, ctx.signal);
    const out: RawHit[] = [];
    for (const [i, s] of parsePypiSearch(html ?? '')
      .slice(0, PER_PROVIDER)
      .entries()) {
      const j =
        i < DETAIL ? await getJson<PypiJson>(f, `https://pypi.org/pypi/${enc(s.name)}/json`) : undefined;
      const license = j ? pypiLicense(j.info) : undefined;
      const home = j?.info.home_page || j?.info.project_urls?.Homepage || '';
      const last = j?.urls?.[0]?.upload_time_iso_8601;
      out.push({
        providerId: 'pypi',
        name: s.name,
        summary: j?.info.summary ?? s.summary,
        officialUrl: home,
        sourceUrl: `https://pypi.org/project/${s.name}/`,
        packageRepo: true,
        ...(license ? { license } : {}),
        installMethod: { kind: 'python-cli', id: s.name, label: '파이썬 명령줄 도구' },
        os: ['windows', 'linux', 'mac'],
        ...(last ? { lastRelease: last } : {}),
      });
    }
    return out;
  },
};

// ── Ollama 라이브러리 ────────────────────────────────────────
export function parseOllamaSearch(html: string): { name: string; summary: string }[] {
  const out: { name: string; summary: string }[] = [];
  const seen = new Set<string>();
  const re = /href="\/library\/([a-z0-9][\w.-]*)"[^>]*>([\s\S]*?)<\/a>/g;
  for (const m of html.matchAll(re)) {
    if (seen.has(m[1]!)) continue;
    seen.add(m[1]!);
    const p = /<p[^>]*>([\s\S]*?)<\/p>/.exec(m[2]!);
    out.push({ name: m[1]!, summary: p ? htmlText(p[1]!) : '' });
  }
  return out;
}

export const ollamaProvider: SearchProvider = {
  id: 'ollama',
  kind: 'package',
  label: 'Ollama 모델 목록',
  available: (ctx) => Boolean(ctx.fetch),
  async search(query, ctx) {
    const q = assertSafeQuery(query);
    const html = await getText(ctx.fetch!, `https://ollama.com/search?q=${enc(q)}`, ctx.signal);
    return parseOllamaSearch(html ?? '')
      .slice(0, PER_PROVIDER)
      .map((m) => ({
        providerId: 'ollama',
        name: m.name,
        summary: m.summary,
        officialUrl: `https://ollama.com/library/${m.name}`,
        sourceUrl: `https://ollama.com/library/${m.name}`,
        packageRepo: true,
        installMethod: { kind: 'ollama-model' as const, id: m.name, label: 'Ollama 공식 모델 목록' },
        os: ['windows' as const, 'linux' as const, 'mac' as const],
        verifiedPublisher: true,
      }));
  },
};

// ── MCP 레지스트리 ───────────────────────────────────────────
interface McpServerJson {
  name: string;
  description?: string;
  version?: string;
  repository?: { url?: string };
  websiteUrl?: string;
  packages?: { registryType?: string; registry_name?: string; identifier?: string; name?: string }[];
  remotes?: { url?: string }[];
}
interface McpRegistryList {
  servers: (McpServerJson | { server: McpServerJson; _meta?: unknown })[];
}

export const mcpRegistryProvider: SearchProvider = {
  id: 'mcp-registry',
  kind: 'package',
  label: 'MCP 공식 목록',
  available: (ctx) => Boolean(ctx.fetch),
  async search(query, ctx) {
    const q = assertSafeQuery(query);
    const r = await getJson<McpRegistryList>(
      ctx.fetch!,
      `https://registry.modelcontextprotocol.io/v0/servers?search=${enc(q)}&limit=${PER_PROVIDER}`,
      ctx.signal,
    );
    const out: RawHit[] = [];
    for (const entry of (r?.servers ?? []).slice(0, PER_PROVIDER)) {
      const s: McpServerJson = 'server' in entry ? entry.server : entry;
      const npm = s.packages?.find((p) => (p.registryType ?? p.registry_name) === 'npm');
      const pkgId = npm?.identifier ?? npm?.name;
      const remote = s.remotes?.[0]?.url;
      const method = pkgId
        ? { kind: 'mcp-local' as const, id: pkgId, label: 'AI 도구 연결(내 컴퓨터)' }
        : remote
          ? { kind: 'mcp-remote' as const, id: remote, label: 'AI 도구 연결(원격)' }
          : undefined;
      out.push({
        providerId: 'mcp-registry',
        name: s.name,
        summary: s.description ?? '',
        officialUrl: s.websiteUrl ?? s.repository?.url ?? '',
        sourceUrl: `https://registry.modelcontextprotocol.io/v0/servers?search=${enc(s.name)}`,
        packageRepo: true,
        ...(method ? { installMethod: method } : {}),
        os: ['windows', 'linux', 'mac'],
      });
    }
    return out;
  },
};

export const PACKAGE_REPO_PROVIDERS: readonly SearchProvider[] = [
  wingetProvider,
  npmProvider,
  pypiProvider,
  ollamaProvider,
  mcpRegistryProvider,
];

/** 공용 도우미 (웹 공급자·가격 페이지 확인) */
export const _http = { getJson, getText, htmlText };
