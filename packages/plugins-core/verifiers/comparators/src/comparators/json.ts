import { asText, result, type CompareDiff, type Comparator } from '../types.js';
import { textComparator, type TextOptions } from './text.js';

/**
 * C.7·C.8 json — 구조 비교
 *  - 키 순서 무시, 숫자는 값으로 비교(`1` = `1.0`)
 *  - ignoreKeys: 이 이름의 키는 어느 깊이에 있든 비교하지 않는다
 *  - arrayOrder: strict(기본) | ignore(배열을 순서 없는 묶음으로)
 *  - 둘 중 하나라도 JSON으로 읽을 수 없으면 text 비교기로 강등하고 사유에 적는다
 * 값이 다르면 different + 첫 차이 위치($.a.b[2])를 diff에 남긴다.
 */
export interface JsonOptions {
  ignoreKeys?: readonly string[];
  arrayOrder?: 'strict' | 'ignore';
  /** 강등 시 text 비교기에 넘길 옵션 */
  text?: TextOptions;
  [k: string]: unknown;
}

type Parsed = { ok: true; value: unknown } | { ok: false; error: string };

function parse(v: unknown): Parsed {
  if (typeof v !== 'string') return { ok: true, value: v };
  try {
    return { ok: true, value: JSON.parse(v) as unknown };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** 정규형: 키 정렬, ignoreKeys 제거, arrayOrder=ignore면 배열 정렬 */
function canonical(v: unknown, o: JsonOptions): unknown {
  if (Array.isArray(v)) {
    const items = v.map((x) => canonical(x, o));
    return o.arrayOrder === 'ignore'
      ? items
          .map((x) => [JSON.stringify(x), x] as const)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([, x]) => x)
      : items;
  }
  if (v && typeof v === 'object') {
    const ignore = new Set(o.ignoreKeys ?? []);
    return Object.fromEntries(
      Object.keys(v)
        .filter((k) => !ignore.has(k))
        .sort()
        .map((k) => [k, canonical((v as Record<string, unknown>)[k], o)]),
    );
  }
  return v;
}

const key = (path: string, k: string) =>
  /^[A-Za-z_$][\w$]*$/.test(k) ? `${path}.${k}` : `${path}[${JSON.stringify(k)}]`;

/** 첫 차이 위치 (같으면 undefined) — 입력은 canonical() 결과 */
function firstDiff(a: unknown, b: unknown, path = '$'): CompareDiff | undefined {
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (i >= a.length) return { at: `${path}[${i}]`, actual: b[i] };
      if (i >= b.length) return { at: `${path}[${i}]`, expected: a[i] };
      const d = firstDiff(a[i], b[i], `${path}[${i}]`);
      if (d) return d;
    }
    return undefined;
  }
  const isObj = (x: unknown) => x !== null && typeof x === 'object' && !Array.isArray(x);
  if (isObj(a) && isObj(b)) {
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    for (const k of [...new Set([...Object.keys(ao), ...Object.keys(bo)])].sort()) {
      if (!(k in bo)) return { at: key(path, k), expected: ao[k] };
      if (!(k in ao)) return { at: key(path, k), actual: bo[k] };
      const d = firstDiff(ao[k], bo[k], key(path, k));
      if (d) return d;
    }
    return undefined;
  }
  return Object.is(a, b) || a === b ? undefined : { at: path, expected: a, actual: b };
}

export const jsonComparator: Comparator<JsonOptions> = {
  kind: 'json',
  normalize(v, ctx, o = {}) {
    const p = parse(v);
    return p.ok ? JSON.stringify(canonical(p.value, o)) : textComparator.normalize(asText(v), ctx, o.text);
  },
  equals(a, b, ctx, o = {}) {
    const pa = parse(a);
    const pb = parse(b);
    if (!pa.ok || !pb.ok) {
      const which = !pa.ok ? `기대값(${pa.error})` : `실제값(${(pb as { error: string }).error})`;
      const r = textComparator.equals(asText(a), asText(b), ctx, o.text);
      return { ...r, reason: `JSON 해석 실패 ${which} → text로 비교: ${r.reason}` };
    }
    const ca = canonical(pa.value, o);
    const cb = canonical(pb.value, o);
    const d = firstDiff(ca, cb);
    if (!d) {
      const notes = [
        '키 순서 무시',
        ...(o.ignoreKeys?.length ? [`무시한 키 ${o.ignoreKeys.join(', ')}`] : []),
        ...(o.arrayOrder === 'ignore' ? ['배열 순서 무시'] : []),
      ];
      return result('equal', 'normalize', `JSON 구조 일치 (${notes.join(', ')})`);
    }
    return result('different', 'normalize', `JSON 값 다름: ${d.at}`, { diff: d });
  },
};
