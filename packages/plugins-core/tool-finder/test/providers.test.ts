import { readFileSync } from 'node:fs';
import { mockRunner } from '@harness-x/installer';
import { parsePluginManifest } from '@harness-x/protocol';
import { describe, expect, it } from 'vitest';
import {
  BRAVE_SECRET_ACCOUNT,
  braveProvider,
  mcpRegistryProvider,
  npmProvider,
  ollamaProvider,
  PACKAGE_REPO_PROVIDERS,
  pypiProvider,
  SearchProviderRegistry,
  searchProvidersOf,
  searxngProvider,
  userAiWebProvider,
  wingetProvider,
  type SearchContext,
  type SearchProvider,
} from '../src/index.js';
import { fakeFetch, NOW, WINGET_SEARCH, wingetShow } from './helpers.js';

const ctx = (p: Partial<SearchContext>): SearchContext => ({ now: () => NOW, ...p });

function secrets(map: Record<string, string>) {
  return { get: (k: string) => map[k] ?? null, set: () => {}, delete: () => false };
}

describe('P3-B.1 검색 공급자 플러그인 슬롯 search', () => {
  it('매니페스트: provides.tool의 search.* 4종 (패키지 저장소·사용자 AI 웹·SearXNG·Brave)', () => {
    const m = parsePluginManifest(
      JSON.parse(readFileSync(new URL('../harness-plugin.json', import.meta.url), 'utf8')),
    );
    expect(searchProvidersOf(m)).toEqual(['package-repos', 'user-ai-web', 'searxng', 'brave']);
  });

  it('모든 공급자가 같은 인터페이스 {id, kind, label, available, search}', () => {
    const all: SearchProvider[] = [
      ...PACKAGE_REPO_PROVIDERS,
      userAiWebProvider(async () => []),
      searxngProvider('http://localhost:8888'),
      braveProvider,
    ];
    expect(all.map((p) => `${p.kind}:${p.id}`)).toEqual([
      'package:winget',
      'package:npm',
      'package:pypi',
      'package:ollama',
      'package:mcp-registry',
      'web:user-ai-web',
      'web:searxng',
      'web:brave',
    ]);
    for (const p of all) {
      expect(typeof p.available).toBe('function');
      expect(typeof p.search).toBe('function');
      expect(p.label.length).toBeGreaterThan(0);
    }
    const reg = new SearchProviderRegistry();
    for (const p of all) reg.register(p);
    expect(() => reg.register(braveProvider)).toThrow(/중복/);
    expect(reg.list()).toHaveLength(8);
  });

  it('① winget: 표 해석 + show로 라이선스·홈페이지 (실행기 모킹)', async () => {
    const runner = mockRunner({
      'winget search': { stdout: WINGET_SEARCH },
      'winget show --id Gyan.FFmpeg': {
        stdout: wingetShow('Gyan.FFmpeg', 'FFmpeg', 'GPL-3.0', 'https://ffmpeg.org', '소리·영상 변환'),
      },
      'winget show --id HandBrake.HandBrake': {
        stdout: wingetShow(
          'HandBrake.HandBrake',
          'HandBrake',
          'GPL-2.0',
          'https://handbrake.fr',
          '영상 변환',
        ),
      },
    });
    const c = ctx({ runner });
    expect(await wingetProvider.available(c)).toBe(true);
    expect(await wingetProvider.available(ctx({}))).toBe(false);
    const hits = await wingetProvider.search('소리 뽑기', c);
    expect(runner.calls[0]!.line).toBe('winget search 소리 뽑기 --accept-source-agreements');
    expect(hits.map((h) => [h.name, h.license, h.installMethod?.id])).toEqual([
      ['FFmpeg', 'GPL-3.0', 'Gyan.FFmpeg'],
      ['HandBrake', 'GPL-2.0', 'HandBrake.HandBrake'],
    ]);
    expect(hits[0]).toMatchObject({
      packageRepo: true,
      os: ['windows'],
      officialUrl: 'https://ffmpeg.org',
      sourceUrl: 'https://github.com/microsoft/winget-pkgs/tree/master/manifests/g/Gyan/FFmpeg',
    });
  });

  it('① npm·PyPI·Ollama·MCP 레지스트리 (fetch 모킹)', async () => {
    const f = fakeFetch({
      'https://registry.npmjs.org/-/v1/search': {
        objects: [{ package: { name: 'audio-extract', description: 'extract audio', date: '2026-01-01' } }],
      },
      'https://registry.npmjs.org/audio-extract/latest': { license: 'MIT' },
      'https://pypi.org/search/': `<a><span class="package-snippet__name">moviepy</span><p class="package-snippet__description">Video editing</p></a>`,
      'https://pypi.org/pypi/moviepy/json': {
        info: {
          name: 'moviepy',
          summary: 'Video editing with Python',
          classifiers: ['License :: OSI Approved :: MIT License'],
        },
        urls: [{ upload_time_iso_8601: '2025-05-01T00:00:00Z' }],
      },
      'https://ollama.com/search': '<a href="/library/whisper-tiny"><p>speech to text</p></a>',
      'https://registry.modelcontextprotocol.io/v0/servers': {
        servers: [
          {
            server: {
              name: 'io.github.x/ffmpeg-mcp',
              description: 'ffmpeg tools for AI',
              packages: [{ registryType: 'npm', identifier: 'ffmpeg-mcp' }],
            },
          },
        ],
      },
    });
    const c = ctx({ fetch: f });
    const [npm] = await npmProvider.search('audio extract', c);
    expect(npm).toMatchObject({ name: 'audio-extract', license: 'MIT', installMethod: { kind: 'npm-cli' } });
    const [py] = await pypiProvider.search('video edit', c);
    expect(py).toMatchObject({ name: 'moviepy', license: 'MIT', lastRelease: '2025-05-01T00:00:00Z' });
    const [ol] = await ollamaProvider.search('speech', c);
    expect(ol).toMatchObject({ name: 'whisper-tiny', installMethod: { kind: 'ollama-model' } });
    const [mcp] = await mcpRegistryProvider.search('ffmpeg', c);
    expect(mcp).toMatchObject({ installMethod: { kind: 'mcp-local', id: 'ffmpeg-mcp' } });
    for (const u of f.calls) expect(u.startsWith('https://')).toBe(true);
  });

  it('② 사용자 AI 웹 검색 · ③ SearXNG · ④ Brave(키 없으면 못 씀, 키는 키체인에서만 헤더로)', async () => {
    const ai = userAiWebProvider(async (q) => [
      { title: `HandBrake: The open source video transcoder`, url: 'https://handbrake.fr/', snippet: q },
    ]);
    const [h] = await ai.search('영상 변환', ctx({}));
    expect(h).toMatchObject({ name: 'HandBrake', packageRepo: false, officialUrl: 'https://handbrake.fr' });

    const f = fakeFetch({
      'http://localhost:8888/search': {
        results: [{ title: 'Audacity - Free audio editor', url: 'https://www.audacityteam.org/' }],
      },
      'https://api.search.brave.com/': {
        web: { results: [{ title: 'Adobe Media Encoder', url: 'https://www.adobe.com/x' }] },
      },
    });
    const sx = searxngProvider('http://localhost:8888/');
    expect(await sx.available(ctx({ fetch: f }))).toBe(true);
    expect((await sx.search('소리 편집', ctx({ fetch: f })))[0]!.name).toBe('Audacity');

    expect(await braveProvider.available(ctx({ fetch: f, secrets: secrets({}) }))).toBe(false);
    const withKey = ctx({ fetch: f, secrets: secrets({ [BRAVE_SECRET_ACCOUNT]: 'BSA-key' }) });
    expect(await braveProvider.available(withKey)).toBe(true);
    const seen: RequestInit[] = [];
    const spy = Object.assign(
      async (u: string, init?: RequestInit) => {
        seen.push(init ?? {});
        return f(u);
      },
      { calls: f.calls },
    );
    const [b] = await braveProvider.search('소리 편집', { ...withKey, fetch: spy });
    expect(b!.name).toBe('Adobe Media Encoder');
    expect((seen[0]!.headers as Record<string, string>)['X-Subscription-Token']).toBe('BSA-key');
    expect(f.calls.some((u) => u.includes('BSA-key'))).toBe(false);
  });
});
