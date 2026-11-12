/**
 * T-101 2B.5 AI 사용 가능 점검
 * 원래 엔진을 지금 쓸 수 없으면 다른 사용 가능 엔진·폴백을 제안한다.
 * 순서: 메인 AI(5번 "입력창 모델 선택"이 정하면 주입) → 엔진 설정의 fallback → 나머지 사용 가능 엔진.
 */

export interface EngineSuggestOptions {
  /** 지금 쓸 수 있는 엔진 id */
  available: readonly string[];
  /** engines-settings.yaml의 fallback (엔진 id → 폴백 목록) */
  fallback?: Readonly<Record<string, string | readonly string[] | undefined>>;
  /** 메인 AI (5번 이후 주입). 사용 가능하면 맨 앞 */
  mainAi?: string;
}

export function suggestEngines(original: string, o: EngineSuggestOptions): string[] {
  const avail = new Set(o.available);
  const fb = o.fallback?.[original];
  const fallbacks = typeof fb === 'string' ? [fb] : [...(fb ?? [])];
  const order = [...(o.mainAi ? [o.mainAi] : []), ...fallbacks, ...o.available];
  const out: string[] = [];
  for (const id of order) if (id !== original && avail.has(id) && !out.includes(id)) out.push(id);
  return out;
}

/** 엔진 설정(EnginesSettings.engines)에서 fallback 표만 뽑기 */
export function fallbackTable(
  engines: Readonly<Record<string, { fallback?: string | readonly string[] } | undefined>> | undefined,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [id, e] of Object.entries(engines ?? {})) {
    const f = e?.fallback;
    if (f && f.length) out[id] = typeof f === 'string' ? [f] : [...f];
  }
  return out;
}
