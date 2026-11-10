import {
  addAlias,
  CanonicalWordSchema,
  ensureProjectGlossary,
  glossaryIndex,
  saveGlossary,
  type Glossary,
  type GlossaryIndex,
} from './glossary.js';
import type { ManifestStore } from './manifest.js';

/**
 * 동치 학습 — 한 번 인정한 동치를 사전에 저장해 다시 묻지 않는다.
 * L4(판정 모델 ≥ 임계값)와 L5("동치 인정")가 함께 쓴다.
 *   - manifest: 산출물 별칭 경로 추가 (revise 경유, manifest_revision 이벤트)
 *   - glossary: 같은 위치의 경로 조각이 다르면 단어 별칭 추가 (예: harness ⇐ ai)
 * 다음 판정은 L2(별칭 사전)에서 끝난다.
 */

export interface WordAlias {
  canonical: string;
  alias: string;
}

function splitExt(seg: string): [string, string] {
  const m = /^(.+?)(\.[A-Za-z0-9]+)$/.exec(seg);
  return m ? [m[1]!, m[2]!.toLowerCase()] : [seg, ''];
}

/**
 * 기대 경로·실제 경로의 조각을 같은 위치끼리 비교해 단어 별칭 후보를 뽑는다.
 * 조각 수가 다르거나 확장자가 다르면 그 조각은 건너뛴다. canonical은 영문 kebab-case 조각
 * (또는 glossary로 찾은 canonical)만.
 */
export function aliasWordPairs(
  expectedPath: string,
  actualPath: string,
  glossary?: Glossary | GlossaryIndex,
): WordAlias[] {
  const idx = glossary ? glossaryIndex(glossary) : undefined;
  const e = expectedPath.split('/').filter(Boolean);
  const a = actualPath.split('/').filter(Boolean);
  if (e.length !== a.length) return [];
  const out: WordAlias[] = [];
  for (let k = 0; k < e.length; k++) {
    const [eb, ee] = splitExt(e[k]!);
    const [ab, ae] = splitExt(a[k]!);
    if (ee !== ae || eb === ab) continue;
    // 기대 조각이 표시 이름(하네스)이면 glossary로 canonical(harness)을 찾는다
    const canonical = CanonicalWordSchema.safeParse(eb).success ? eb : idx?.lookup(eb);
    if (!canonical || canonical === ab || idx?.lookup(ab) === canonical) continue;
    out.push({ canonical, alias: ab });
  }
  return out;
}

export interface LearnEquivalenceOptions {
  expectedPath: string;
  actualPath: string;
  reason: string;
  /** 산출물 별칭을 추가할 manifest (artifactId와 함께) */
  manifest?: Pick<ManifestStore, 'addPathAlias'>;
  artifactId?: string;
  /** 프로젝트 glossary.json (없으면 기본값 복사) */
  glossaryFile?: string;
}

export interface LearnEquivalenceResult {
  manifestAlias: boolean;
  glossaryAliases: WordAlias[];
  /** 추가하지 못한 별칭과 사유 (이미 다른 canonical에 묶임 등) */
  skipped: { alias: string; reason: string }[];
}

export function learnEquivalence(opts: LearnEquivalenceOptions): LearnEquivalenceResult {
  const res: LearnEquivalenceResult = { manifestAlias: false, glossaryAliases: [], skipped: [] };
  if (opts.manifest && opts.artifactId) {
    opts.manifest.addPathAlias(opts.artifactId, opts.actualPath, opts.reason);
    res.manifestAlias = true;
  }
  if (opts.glossaryFile) {
    let g = ensureProjectGlossary(opts.glossaryFile);
    const before = g;
    for (const p of aliasWordPairs(opts.expectedPath, opts.actualPath, g)) {
      try {
        const next = addAlias(g, p.canonical, p.alias);
        if (next !== g) res.glossaryAliases.push(p);
        g = next;
      } catch (err) {
        res.skipped.push({ alias: p.alias, reason: err instanceof Error ? err.message : String(err) });
      }
    }
    if (g !== before) saveGlossary(opts.glossaryFile, g);
  }
  return res;
}
