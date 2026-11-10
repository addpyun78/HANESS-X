import {
  canonicalizeSegment,
  glossaryIndex,
  type Glossary,
  type GlossaryIndex,
  type Manifest,
} from '@harness-x/checklist-ledger';
import { aliasKeyOf, isWithinKey, normalizePath } from '@harness-x/verifier-ladder';

/**
 * 24.3 쓰기 대상 경로 → manifest 매칭 (판정 사다리 L1 정규화 + L2 glossary 별칭만, 즉시·무료)
 *  - exact:     L1 정규화 후 정식 경로(또는 그 아래)와 같다 → 그대로 허용
 *  - corrected: L2(별칭 치환) 후에만 같다 → 정식 경로를 알려 주고 다시 쓰게 한다
 *  - outside:   어떤 산출물과도 매칭되지 않는다 (워크스페이스 밖 포함)
 */

export type PathMatch =
  | { kind: 'exact'; artifactId: string; path: string; canonical: string }
  | { kind: 'corrected'; artifactId: string; path: string; canonical: string; level: 1 | 2 }
  | { kind: 'outside'; path: string; reason: 'not_in_manifest' | 'outside_workspace' };

export interface MatchOptions {
  /** 워크스페이스 루트 (manifest 경로의 기준) */
  workspace: string;
  /** 상대 경로의 기준 (기본 workspace) */
  cwd?: string;
  glossary: Glossary | GlossaryIndex;
}

/** 워크스페이스 기준 상대 키 (밖이면 null) */
export function workspaceRelative(
  path: string,
  opts: Pick<MatchOptions, 'workspace' | 'cwd'>,
): string | null {
  const root = normalizePath(opts.workspace);
  const key = normalizePath(path, { cwd: opts.cwd ?? opts.workspace });
  if (!isWithinKey(key, root)) return null;
  return key === root ? '' : key.slice(root.length + 1);
}

/** 산출물 아래 나머지 조각: 라틴 문자만이면 그대로, 아니면 이름 정책으로 영문화 */
function canonicalRest(segments: string[], idx: GlossaryIndex): string[] {
  return segments.map((s) => {
    // eslint-disable-next-line no-control-regex
    if (/^[\x00-\x7f]*$/.test(s)) return s;
    const m = /^(.+?)(\.[A-Za-z0-9]+)$/.exec(s);
    const b = m ? m[1]! : s;
    const ext = m ? m[2]!.toLowerCase() : '';
    return (canonicalizeSegment(b, idx).value || b) + ext;
  });
}

export function matchManifestPath(path: string, manifest: Manifest | null, opts: MatchOptions): PathMatch {
  const rel = workspaceRelative(path, opts);
  if (rel === null) return { kind: 'outside', path, reason: 'outside_workspace' };
  if (!manifest) return { kind: 'outside', path, reason: 'not_in_manifest' };
  const idx = glossaryIndex(opts.glossary);
  const relL2 = aliasKeyOf(rel, idx);
  // 긴(구체적) 정식 경로부터
  const entries = Object.entries(manifest.artifacts).sort(([, a], [, b]) => b.path.length - a.path.length);
  for (const [artifactId, e] of entries) {
    for (const p of [e.path, ...(e.aliases ?? [])]) {
      const key = normalizePath(p);
      if (isWithinKey(rel, key)) {
        if (p === e.path) return { kind: 'exact', artifactId, path, canonical: rel };
        // 동치로 인정된 별칭 경로 → 정식 경로로 교정
        const rest = rel === key ? [] : rel.slice(key.length + 1).split('/');
        return {
          kind: 'corrected',
          artifactId,
          path,
          canonical: [e.path, ...rest].join('/'),
          level: 1,
        };
      }
      const keyL2 = aliasKeyOf(key, idx);
      if (isWithinKey(relL2, keyL2)) {
        const depth = key.split('/').length;
        const rest = rel.split('/').slice(depth);
        return {
          kind: 'corrected',
          artifactId,
          path,
          canonical: [e.path, ...canonicalRest(rest, idx)].join('/'),
          level: 2,
        };
      }
    }
  }
  return { kind: 'outside', path, reason: 'not_in_manifest' };
}
