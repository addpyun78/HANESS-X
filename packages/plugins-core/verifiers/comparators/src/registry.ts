import type { PluginManifest } from '@harness-x/protocol';
import { BUILTIN_COMPARATORS } from './builtins.js';
import type { Comparator } from './types.js';

/**
 * B.4 비교기 레지스트리
 * 기본 비교기 8종(exact·path·text·json·number·version·regex·exitCode) + 플러그인이 manifest
 * `provides.comparator`로 선언한 비교기. 같은 kind를 두 번 등록할 수 없다(기본 비교기 덮어쓰기 금지).
 */

/** 비교기 종류 이름: 영문으로 시작, 영숫자·하이픈 */
const KIND_RE = /^[A-Za-z][A-Za-z0-9-]*$/;

export interface RegisteredComparator {
  comparator: Comparator;
  /** builtin 또는 플러그인 id */
  source: string;
}

export interface ComparatorRegistry {
  register(c: Comparator, opts?: { source?: string }): void;
  get(kind: string): Comparator | undefined;
  /** 없으면 오류 */
  require(kind: string): Comparator;
  has(kind: string): boolean;
  kinds(): string[];
  sourceOf(kind: string): string | undefined;
  /** 플러그인 모듈의 비교기를 manifest provides.comparator에 맞춰 등록. 등록된 kind 목록 반환 */
  registerPlugin(manifest: Pick<PluginManifest, 'id' | 'provides'>, mod: unknown): string[];
}

function isComparator(x: unknown): x is Comparator {
  return (
    !!x &&
    typeof x === 'object' &&
    typeof (x as Comparator).kind === 'string' &&
    typeof (x as Comparator).normalize === 'function' &&
    typeof (x as Comparator).equals === 'function'
  );
}

/** 모듈에서 비교기 꺼내기: export comparators = [...] 또는 export comparator / default */
function comparatorsOf(mod: unknown): Comparator[] {
  const m = (mod ?? {}) as Record<string, unknown>;
  const list = Array.isArray(m.comparators) ? m.comparators : [m.comparator ?? m.default];
  return list.filter(isComparator);
}

export function createComparatorRegistry(opts: { builtins?: boolean } = {}): ComparatorRegistry {
  const map = new Map<string, RegisteredComparator>();
  const reg: ComparatorRegistry = {
    register(c, o = {}) {
      if (!isComparator(c)) throw new TypeError('비교기는 kind·normalize·equals가 필요합니다');
      if (!KIND_RE.test(c.kind)) throw new RangeError(`비교기 kind 형식 오류: ${c.kind}`);
      const prev = map.get(c.kind);
      if (prev) throw new Error(`비교기 '${c.kind}'는 이미 ${prev.source}에서 등록됨`);
      map.set(c.kind, { comparator: c, source: o.source ?? 'builtin' });
    },
    get: (kind) => map.get(kind)?.comparator,
    require(kind) {
      const c = map.get(kind)?.comparator;
      if (!c) throw new Error(`등록되지 않은 비교기: ${kind} (등록됨: ${[...map.keys()].join(', ')})`);
      return c;
    },
    has: (kind) => map.has(kind),
    kinds: () => [...map.keys()],
    sourceOf: (kind) => map.get(kind)?.source,
    registerPlugin(manifest, mod) {
      const declared = manifest.provides.comparator ?? [];
      if (declared.length === 0)
        throw new Error(`플러그인 ${manifest.id}은(는) provides.comparator를 선언하지 않았습니다`);
      const found = comparatorsOf(mod);
      const byKind = new Map(found.map((c) => [c.kind, c]));
      for (const kind of declared)
        if (!byKind.has(kind))
          throw new Error(`플러그인 ${manifest.id}: 선언한 비교기 '${kind}'를 모듈이 내보내지 않음`);
      for (const c of found)
        if (!declared.includes(c.kind))
          throw new Error(`플러그인 ${manifest.id}: 선언하지 않은 비교기 '${c.kind}'`);
      for (const kind of declared) reg.register(byKind.get(kind)!, { source: manifest.id });
      return [...declared];
    },
  };
  if (opts.builtins ?? true) for (const c of BUILTIN_COMPARATORS) reg.register(c);
  return reg;
}

/** 기본 레지스트리 (기본 비교기만) */
export const defaultComparators: ComparatorRegistry = createComparatorRegistry();
