import { createHash } from 'node:crypto';
import type { JudgeOutcome } from './types.js';

/**
 * E.12 판정 캐시: (비교기 종류, 정규화 기대값 해시, 정규화 실제값 해시) → 결과.
 * 같은 쌍은 다시 묻지 않는다. 값 원문은 저장하지 않고 해시만 키로 쓴다.
 * unavailable(일시 실패)은 캐시하지 않는다.
 */

export const JUDGE_CACHE_MAX_ENTRIES = 1000;

/** 유니코드 NFC, CRLF→LF, 앞뒤 공백 제거, 연속 공백 하나로 */
export function normalizeForCache(s: string): string {
  return s
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .trim()
    .replace(/[ \t]+/g, ' ');
}

export function sha256Hex(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

export function judgeCacheKey(kind: string, expected: string, actual: string): string {
  return `${kind}:${sha256Hex(normalizeForCache(expected))}:${sha256Hex(normalizeForCache(actual))}`;
}

export class JudgeCache {
  private readonly map = new Map<string, JudgeOutcome>();
  constructor(private readonly maxEntries = JUDGE_CACHE_MAX_ENTRIES) {}

  get size(): number {
    return this.map.size;
  }

  get(key: string): JudgeOutcome | undefined {
    const v = this.map.get(key);
    if (v) {
      // 최근 사용으로 갱신
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }

  set(key: string, outcome: JudgeOutcome): void {
    if (outcome.verdict === 'unavailable') return;
    this.map.delete(key);
    this.map.set(key, outcome);
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  clear(): void {
    this.map.clear();
  }
}
