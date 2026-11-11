import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChecklistLedger } from '@harness-x/checklist-ledger';
import type { ToolEntry } from '@harness-x/installer';
import type { RawHit, SearchProvider, ToolCandidate } from '../src/index.js';
import { rawToCandidate } from '../src/index.js';

export const NOW = new Date('2026-11-11T09:00:00.000Z');

export function tempHome(prefix = 'hx-tool-finder-'): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** 주소 → 응답 (접두어 일치). 부른 주소를 기록한다. 실제 네트워크 없음 */
export function fakeFetch(routes: Record<string, unknown | ((url: string) => unknown)>) {
  const calls: string[] = [];
  const f = async (url: string) => {
    calls.push(url);
    const key = Object.keys(routes)
      .filter((k) => url.startsWith(k))
      .sort((a, b) => b.length - a.length)[0];
    if (!key) return new Response('not found', { status: 404 });
    const v = routes[key];
    const body = typeof v === 'function' ? (v as (u: string) => unknown)(url) : v;
    return typeof body === 'string'
      ? new Response(body, { status: 200, headers: { 'content-type': 'text/html' } })
      : Response.json(body);
  };
  return Object.assign(f, { calls });
}

export function hit(p: Partial<RawHit> & { name: string }): RawHit {
  return {
    providerId: 'test',
    summary: '',
    officialUrl: '',
    sourceUrl: `https://example.org/${encodeURIComponent(p.name)}`,
    packageRepo: true,
    ...p,
  };
}

export function cand(p: Partial<RawHit> & { name: string }): ToolCandidate {
  const c = rawToCandidate(hit(p), NOW);
  if (!c) throw new Error('후보 만들기 실패');
  return c;
}

/** 고정 결과를 주는 공급자 (호출 기록) */
export function staticProvider(
  id: string,
  kind: 'package' | 'web',
  hits: RawHit[],
  log: string[] = [],
): SearchProvider & { queries: string[] } {
  const queries: string[] = [];
  return {
    id,
    kind,
    label: id,
    queries,
    available: () => true,
    search: async (q) => {
      queries.push(q);
      log.push(id);
      return hits;
    },
  };
}

export function toolEntry(p: Partial<ToolEntry> & { name: string }): ToolEntry {
  return {
    id: `winget:${p.name}`,
    kind: 'winget',
    version: '1.0',
    command: `C:\\Tools\\${p.name}.exe`,
    pricing: { tier: 'free', note: '', checkedAt: NOW.toISOString(), sourceUrl: 'https://example.org' },
    license: { id: 'MIT', plain: '누구나 무료로 쓸 수 있어요.' },
    source: { url: 'https://example.org', publisher: 'x', verified: true },
    installedAt: NOW.toISOString(),
    origin: 'installed',
    purpose: p.name,
    capabilities: [],
    howToUse: [`${p.name} --help`],
    ...p,
  };
}

/** 체크리스트 원장 (임시 폴더) — 항목: [id, 제목, deps] */
export function ledgerWith(dir: string, items: [string, string, string[]?][]): ChecklistLedger {
  const l = new ChecklistLedger({ dir, sessionId: 's1', now: () => NOW });
  l.create(
    items.map(([id, title, deps]) => ({
      id,
      title,
      deps: deps ?? [],
      artifactId: 'art.work',
      acceptance: [{ type: 'command' as const, run: 'true' }],
    })),
  );
  return l;
}

/** D.4 공용 시나리오 픽스처: winget 결과 2개(ffmpeg·HandBrake, 오픈소스) + 웹 결과 1개(Adobe, 가격 페이지 유료) */
export const WINGET_SEARCH = [
  'Name                 Id                       Version  Source',
  '---------------------------------------------------------------',
  'FFmpeg               Gyan.FFmpeg              7.1      winget',
  'HandBrake            HandBrake.HandBrake      1.9.0    winget',
  '',
].join('\n');

export function wingetShow(
  id: string,
  name: string,
  license: string,
  homepage: string,
  desc: string,
): string {
  return [
    `Found ${name} [${id}]`,
    'Version: 1.0',
    `Publisher: ${name}`,
    `Description: ${desc}`,
    `Homepage: ${homepage}`,
    `License: ${license}`,
    '',
  ].join('\n');
}
