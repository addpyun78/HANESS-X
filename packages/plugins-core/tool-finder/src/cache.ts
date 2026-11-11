import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { ToolCandidateSchema, type ToolCandidate } from './candidate.js';

/**
 * P3-B.8 검색 결과 7일 캐시 — <home>/tools/search-cache.json
 * 열쇠 = (정리된 검색어, 예산, 사용자 OS). 가격 확인 날짜(pricing.checkedAt)는 그대로 보관해 화면에 표시한다.
 */

export const SEARCH_CACHE_TTL_MS = 7 * 24 * 3600 * 1000;

export function searchCacheFile(home: string): string {
  return join(home, 'tools', 'search-cache.json');
}

const EntrySchema = z.object({
  at: z.string(),
  candidates: z.array(ToolCandidateSchema),
  notices: z.array(z.string()),
});
const FileSchema = z.object({ version: z.literal(1), entries: z.record(z.string(), EntrySchema) });
type CacheFile = z.infer<typeof FileSchema>;

export interface CachedSearch {
  at: string;
  candidates: ToolCandidate[];
  notices: string[];
}

export class SearchCache {
  readonly file: string;
  constructor(
    home: string,
    private readonly ttlMs = SEARCH_CACHE_TTL_MS,
  ) {
    this.file = searchCacheFile(home);
  }

  static key(query: string, budget: string, os: string): string {
    return `${os}|${budget}|${query.toLowerCase()}`;
  }

  private read(): CacheFile {
    if (!existsSync(this.file)) return { version: 1, entries: {} };
    try {
      const r = FileSchema.safeParse(JSON.parse(readFileSync(this.file, 'utf8')));
      return r.success ? r.data : { version: 1, entries: {} };
    } catch {
      return { version: 1, entries: {} };
    }
  }

  private write(f: CacheFile): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(f, null, 2) + '\n');
    renameSync(tmp, this.file);
  }

  get(key: string, now: Date): CachedSearch | undefined {
    const e = this.read().entries[key];
    if (!e) return undefined;
    return now.getTime() - Date.parse(e.at) < this.ttlMs ? e : undefined;
  }

  set(key: string, value: Omit<CachedSearch, 'at'>, now: Date): void {
    const f = this.read();
    // 오래된 항목 정리
    for (const [k, e] of Object.entries(f.entries))
      if (now.getTime() - Date.parse(e.at) >= this.ttlMs) delete f.entries[k];
    f.entries[key] = { at: now.toISOString(), ...value };
    this.write(f);
  }
}

/** 화면용 확인 날짜 "11/11 확인" */
export function checkedLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '확인 날짜 없음';
  return `${d.getMonth() + 1}/${d.getDate()} 확인`;
}
