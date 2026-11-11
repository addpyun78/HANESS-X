import { aliasKeyOf, type AliasOptions } from '../path-alias.js';
import {
  asText,
  defaultCompareCtx,
  inDictionary,
  result,
  type CompareCtx,
  type Comparator,
} from '../types.js';
import { normalizePath, type NormalizeOptions } from '../path-normalize.js';

/**
 * C.2·C.3 path — T-025 판정 사다리 L1(정규화) + L2(glossary)를 이 비교기로 옮겼다.
 *  normalize: NFC·구분자(\ → /)·`./`·끝 슬래시·Windows 대소문자·`C:\` ⇄ `/mnt/c/`·realpath(옵션)
 *  dictionary: glossary 단어 치환(하네스 → harness)·표기 관례(camelCase ⇄ kebab-case), manifest 별칭 경로,
 *              사전 쌍(equivalences, kind=path)
 *  `-`·`_`만 다른 경우는 사전 허용 규칙 `path.dash-underscore`가 있을 때만 같다고 본다(기본 꺼짐) → 없으면 uncertain.
 * 같다고 확정하지 못하면 uncertain(위치가 다른지·같은 뜻인지는 의미 판단 칸이 본다).
 */
export interface PathOptions extends Omit<NormalizeOptions, 'cwd'> {
  /** 상대 경로 기준 (기본 ctx.workspaceRoot, null이면 상대 경로 그대로 비교) */
  cwd?: string | null;
  /** false면 정규화 칸만 (glossary·사전 미사용). 기본 true */
  dictionary?: boolean;
  /** manifest에 등록된 기대 경로의 별칭 경로들 */
  aliases?: readonly string[];
  [k: string]: unknown;
}

function nopts(ctx: CompareCtx, o: PathOptions): NormalizeOptions {
  const cwd = o.cwd === undefined ? ctx.workspaceRoot || undefined : (o.cwd ?? undefined);
  return {
    ...(cwd !== undefined ? { cwd } : {}),
    caseInsensitive: o.caseInsensitive ?? (ctx.os === 'win' ? true : 'auto'),
    ...(o.realpath !== undefined ? { realpath: o.realpath } : {}),
  };
}

const dashKey = (s: string) => s.replace(/_/g, '-');

/** 두 정규 키가 `-`·`_` 차이만 있는 조각을 가지는가 */
function separatorOnlySegments(a: string, b: string): string[] {
  const as = a.split('/');
  const bs = b.split('/');
  if (as.length !== bs.length) return [];
  const out: string[] = [];
  for (let k = 0; k < as.length; k++)
    if (as[k] !== bs[k] && dashKey(as[k]!) === dashKey(bs[k]!)) out.push(`${as[k]} ⇄ ${bs[k]}`);
  return out;
}

function firstSegmentDiff(a: string, b: string) {
  const as = a.split('/');
  const bs = b.split('/');
  for (let k = 0; k < Math.max(as.length, bs.length); k++)
    if (as[k] !== bs[k]) return { at: `segment ${k + 1}`, expected: as[k], actual: bs[k] };
  return { at: 'path' };
}

export const pathComparator: Comparator<PathOptions> = {
  kind: 'path',
  normalize: (v, ctx, o = {}) => normalizePath(asText(v), nopts(ctx, o)),
  equals(a, b, ctx, o = {}) {
    const n = nopts(ctx, o);
    const na = normalizePath(asText(a), n);
    const nb = normalizePath(asText(b), n);
    if (na === nb) return result('equal', 'normalize', '정규화 후 경로 일치');
    if (o.dictionary === false)
      return result('uncertain', 'normalize', '정규화 후 경로 다름', { diff: firstSegmentDiff(na, nb) });

    const dashRule = ctx.equivalences.rules.includes('path.dash-underscore');
    const sep = separatorOnlySegments(na, nb);
    const ka = aliasKeyOf(na, ctx.glossary);
    const kb = aliasKeyOf(nb, ctx.glossary);
    if (ka === kb || (dashRule && dashKey(na) === dashKey(nb))) {
      if (sep.length > 0 && !dashRule)
        return result(
          'uncertain',
          'dictionary',
          `'-'와 '_'만 다름 (${sep.join(', ')}) — 사전 허용 규칙(path.dash-underscore)이 없어 확정하지 않음`,
          { diff: firstSegmentDiff(na, nb) },
        );
      return result(
        'equal',
        'dictionary',
        sep.length > 0
          ? `사전 허용 규칙으로 '-'·'_' 동치 (${sep.join(', ')})`
          : `glossary 별칭 치환 후 경로 일치 (${ka})`,
      );
    }
    for (const alias of o.aliases ?? []) {
      const nal = normalizePath(alias, n);
      if (nal === nb || aliasKeyOf(nal, ctx.glossary) === kb)
        return result('equal', 'dictionary', `manifest 별칭 경로 일치 (${alias})`);
    }
    if (inDictionary('path', na, nb, ctx, (s) => normalizePath(s, n)))
      return result('equal', 'dictionary', '사전에 등록된 같은 경로');
    return result(
      'uncertain',
      'dictionary',
      '정규화·사전으로 같은 경로라고 확정할 수 없음 — 의미 판단 필요',
      {
        diff: firstSegmentDiff(na, nb),
      },
    );
  },
};

function ladderOptions(opts: NormalizeOptions): PathOptions {
  return {
    cwd: opts.cwd ?? null,
    caseInsensitive: opts.caseInsensitive ?? 'auto',
    ...(opts.realpath !== undefined ? { realpath: opts.realpath } : {}),
  };
}

/** L1 동치 (판정 사다리 호환): path 비교기의 정규화 칸에서 같다 */
export function pathsEqualL1(a: string, b: string, opts: NormalizeOptions = {}): boolean {
  const r = pathComparator.equals(a, b, defaultCompareCtx({ os: 'posix' }), {
    ...ladderOptions(opts),
    dictionary: false,
  });
  return r.verdict === 'equal';
}

/** L2 동치 (판정 사다리 호환): path 비교기의 사전 칸(glossary)까지 써서 같다 */
export function pathsEqualL2(a: string, b: string, opts: AliasOptions): boolean {
  const ctx = defaultCompareCtx({ os: 'posix', glossary: opts.glossary });
  return pathComparator.equals(a, b, ctx, ladderOptions(opts)).verdict === 'equal';
}
