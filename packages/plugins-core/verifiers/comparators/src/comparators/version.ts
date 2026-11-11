import { asText, result, type Comparator } from '../types.js';

/**
 * C.10 version — 앞의 `v` 제거, 빠진 자리는 0 (`1.2` = `1.2.0`), 빌드 메타데이터(+…) 무시.
 * range 옵션이 있으면 기대값 대신 범위(`^1.2`, `~1.2.3`, `>=1.2 <2`, `1.x`, `a || b`)를 만족하는지 본다.
 */
export interface VersionOptions {
  range?: string;
  [k: string]: unknown;
}

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
  pre: string[];
}

const VER_RE = /^[vV=]?\s*(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function parseVersion(v: unknown): SemVer | null {
  const m = VER_RE.exec(asText(v).trim());
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2] ?? 0),
    patch: Number(m[3] ?? 0),
    pre: m[4] ? m[4].split('.') : [],
  };
}

export function formatVersion(s: SemVer): string {
  return `${s.major}.${s.minor}.${s.patch}${s.pre.length ? `-${s.pre.join('.')}` : ''}`;
}

/** semver 우선순위 비교 (-1 | 0 | 1) */
export function compareVersions(a: SemVer, b: SemVer): number {
  for (const k of ['major', 'minor', 'patch'] as const) if (a[k] !== b[k]) return a[k] < b[k] ? -1 : 1;
  if (!a.pre.length || !b.pre.length) return a.pre.length === b.pre.length ? 0 : a.pre.length ? -1 : 1;
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i];
    const y = b.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    const nx = /^\d+$/.test(x);
    const ny = /^\d+$/.test(y);
    if (nx && ny) return Number(x) < Number(y) ? -1 : 1;
    if (nx !== ny) return nx ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

type Cmp = { op: '<' | '<=' | '>' | '>=' | '='; v: SemVer };

/** 범위 조각 하나(공백으로 이어진 조건들) → 비교 목록 */
function parseRangePart(part: string): Cmp[] | null {
  const out: Cmp[] = [];
  for (const tok of part.trim().split(/\s+/).filter(Boolean)) {
    const m =
      /^(\^|~|>=|<=|>|<|=)?\s*[vV]?(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:-([0-9A-Za-z.-]+))?$/.exec(
        tok,
      );
    if (!m) {
      if (tok === '*' || tok.toLowerCase() === 'x') continue;
      return null;
    }
    const op = m[1] ?? '';
    const wild = (s?: string) => s === undefined || /^[xX*]$/.test(s);
    const major = Number(m[2]);
    const minorW = wild(m[3]);
    const patchW = wild(m[4]);
    if (wild(m[2])) continue; // * 전체
    const minor = minorW ? 0 : Number(m[3]);
    const patch = patchW ? 0 : Number(m[4]);
    const base: SemVer = { major, minor, patch, pre: m[5] ? m[5].split('.') : [] };
    const v = (ma: number, mi: number, pa: number): SemVer => ({ major: ma, minor: mi, patch: pa, pre: [] });
    if (op === '^') {
      const upper =
        major > 0
          ? v(major + 1, 0, 0)
          : minor > 0 || minorW
            ? v(0, minorW ? 1 : minor + 1, 0)
            : v(0, 0, patch + 1);
      out.push({ op: '>=', v: base }, { op: '<', v: upper });
    } else if (op === '~') {
      out.push({ op: '>=', v: base }, { op: '<', v: minorW ? v(major + 1, 0, 0) : v(major, minor + 1, 0) });
    } else if (op === '' || op === '=') {
      if (minorW) out.push({ op: '>=', v: base }, { op: '<', v: v(major + 1, 0, 0) });
      else if (patchW) out.push({ op: '>=', v: base }, { op: '<', v: v(major, minor + 1, 0) });
      else out.push({ op: '=', v: base });
    } else out.push({ op: op as Cmp['op'], v: base });
  }
  return out;
}

/** 버전이 범위를 만족하는가 (범위 해석 실패 시 null) */
export function satisfiesRange(ver: SemVer, range: string): boolean | null {
  const parts = range.split('||').map(parseRangePart);
  if (parts.some((p) => p === null)) return null;
  return (parts as Cmp[][]).some((cmps) =>
    cmps.every(({ op, v }) => {
      const c = compareVersions(ver, v);
      return op === '<' ? c < 0 : op === '<=' ? c <= 0 : op === '>' ? c > 0 : op === '>=' ? c >= 0 : c === 0;
    }),
  );
}

export const versionComparator: Comparator<VersionOptions> = {
  kind: 'version',
  normalize(v) {
    const s = parseVersion(v);
    return s ? formatVersion(s) : asText(v).trim();
  },
  equals(a, b, _ctx, o = {}) {
    const vb = parseVersion(b);
    if (!vb)
      return result(
        'uncertain',
        'normalize',
        `실제값을 버전으로 읽을 수 없음 (${asText(b)}) — 의미 판단 필요`,
      );
    if (o.range !== undefined) {
      const ok = satisfiesRange(vb, o.range);
      if (ok === null) return result('different', 'normalize', `버전 범위를 해석할 수 없음: ${o.range}`);
      return ok
        ? result('equal', 'normalize', `${formatVersion(vb)}이(가) 범위 ${o.range}를 만족`)
        : result('different', 'normalize', `${formatVersion(vb)}이(가) 범위 ${o.range} 밖`, {
            diff: { at: 'version', expected: o.range, actual: formatVersion(vb) },
          });
    }
    const va = parseVersion(a);
    if (!va)
      return result(
        'uncertain',
        'normalize',
        `기대값을 버전으로 읽을 수 없음 (${asText(a)}) — 의미 판단 필요`,
      );
    if (compareVersions(va, vb) === 0)
      return result('equal', 'normalize', `버전 일치 (${formatVersion(vb)})`);
    return result('different', 'normalize', `버전 다름: ${formatVersion(vb)} (기대 ${formatVersion(va)})`, {
      diff: { at: 'version', expected: formatVersion(va), actual: formatVersion(vb) },
    });
  },
};
