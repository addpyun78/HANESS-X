import type { ToolEntry } from '@harness-x/installer';
import { needKey } from './need.js';

/**
 * P3-A.3 도구 목록(Part 2 F) 먼저 매칭. 이미 있으면 검색 없이 "이미 있는 도구를 쓸게요".
 *  - 도구 목록 항목의 capabilities에 같은 필요 열쇠가 있으면 일치 (도구 찾기로 설치한 도구는 이 열쇠가 들어간다)
 *  - 아니면 능력 설명의 낱말이 용도·이름·태그에 60% 이상 들어 있으면 일치
 */

export const ALREADY_HAVE_MESSAGE = '이미 있는 도구를 쓸게요.';

/** 받침 조사 등 짧은 꼬리를 떼고 2자 이상 낱말만 */
export function capabilityWords(text: string): string[] {
  return text
    .normalize('NFC')
    .toLowerCase()
    .split(/[\s,./·()]+/)
    .map((w) => w.replace(/(에서|으로|하기|에게|를|을|이|가|은|는|의|로|에|만|도)$/u, ''))
    .filter((w) => w.length >= 2);
}

export function matchScore(
  capability: string,
  t: Pick<ToolEntry, 'name' | 'purpose' | 'capabilities'>,
): number {
  const key = needKey(capability);
  if (t.capabilities.some((c) => needKey(c) === key) || needKey(t.purpose) === key) return 1;
  const words = capabilityWords(capability);
  if (words.length === 0) return 0;
  const hay = [t.name, t.purpose, ...t.capabilities].join(' ').toLowerCase();
  return words.filter((w) => hay.includes(w)).length / words.length;
}

export function matchRegistry(
  capability: string,
  tools: readonly ToolEntry[],
  threshold = 0.6,
): ToolEntry | undefined {
  let best: { t: ToolEntry; s: number } | undefined;
  for (const t of tools) {
    const s = matchScore(capability, t);
    if (s >= threshold && (!best || s > best.s)) best = { t, s };
  }
  return best?.t;
}
