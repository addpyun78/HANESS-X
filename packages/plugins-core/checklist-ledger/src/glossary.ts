import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { readJson, writeFileAtomic } from './fs-util.js';

/**
 * 프로젝트 glossary.json — 표시 이름 단어(한글 등) ⇄ 경로 단어(영문 kebab-case) 동치 사전.
 * 이름 정책(표시 이름 → 정식 경로)과 판정 사다리 L2(별칭 치환 비교)가 함께 쓴다.
 * canonical 하나에 별칭 여러 개 (예: harness ⇐ 하네스, ai). L5 "동치 인정" 시 별칭이 추가된다.
 */

/** 영문 kebab-case 단어 (경로 조각 1개) */
export const CanonicalWordSchema = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
  message: 'canonical은 영문 소문자 kebab-case',
});

export const GlossaryTermSchema = z
  .object({
    canonical: CanonicalWordSchema,
    aliases: z.array(z.string().trim().min(1)).min(1),
  })
  .strict();
export type GlossaryTerm = z.infer<typeof GlossaryTermSchema>;

export const GlossarySchema = z
  .object({
    version: z.literal(1),
    terms: z.array(GlossaryTermSchema),
  })
  .strict()
  .superRefine((g, ctx) => {
    const owner = new Map<string, string>();
    for (const [k, t] of g.terms.entries()) {
      for (const a of [t.canonical, ...t.aliases]) {
        const key = normalizeWord(a);
        const prev = owner.get(key);
        if (prev !== undefined && prev !== t.canonical)
          ctx.addIssue({
            code: 'custom',
            message: `별칭 "${a}"가 ${prev}와 ${t.canonical}에 중복 등록됨`,
            path: ['terms', k],
          });
        owner.set(key, t.canonical);
      }
    }
  });
export type Glossary = z.infer<typeof GlossarySchema>;

/** 비교용 단어 정규화: NFC + 소문자 + 앞뒤 공백 제거 */
export function normalizeWord(w: string): string {
  return w.normalize('NFC').trim().toLowerCase();
}

/** 빠른 조회용 색인: 정규화된 별칭/canonical → canonical */
export class GlossaryIndex {
  private readonly map = new Map<string, string>();
  /** 한글 별칭 (긴 것부터) — 띄어쓰기 없는 합성어 분해용 */
  readonly hangulAliases: string[];

  constructor(readonly glossary: Glossary) {
    for (const t of glossary.terms) {
      this.map.set(normalizeWord(t.canonical), t.canonical);
      for (const a of t.aliases) this.map.set(normalizeWord(a), t.canonical);
    }
    this.hangulAliases = [...this.map.keys()].filter((k) => /^[\p{Script=Hangul}]+$/u.test(k));
    this.hangulAliases.sort((a, b) => b.length - a.length);
  }

  /** 단어 → canonical (없으면 undefined) */
  lookup(word: string): string | undefined {
    return this.map.get(normalizeWord(word));
  }

  get size(): number {
    return this.glossary.terms.length;
  }
}

const indexCache = new WeakMap<Glossary, GlossaryIndex>();
export function glossaryIndex(g: Glossary | GlossaryIndex): GlossaryIndex {
  if (g instanceof GlossaryIndex) return g;
  let idx = indexCache.get(g);
  if (!idx) {
    idx = new GlossaryIndex(g);
    indexCache.set(g, idx);
  }
  return idx;
}

export function parseGlossary(value: unknown): Glossary {
  return GlossarySchema.parse(value);
}

/** 패키지에 들어 있는 기본 glossary.json 경로 (프로젝트가 복사해 쓴다) */
export const DEFAULT_GLOSSARY_FILE = fileURLToPath(new URL('../glossary.json', import.meta.url));

export function loadGlossary(file: string): Glossary {
  return parseGlossary(readJson(file));
}

export function loadDefaultGlossary(): Glossary {
  return loadGlossary(DEFAULT_GLOSSARY_FILE);
}

export function saveGlossary(file: string, g: Glossary): void {
  writeFileAtomic(file, JSON.stringify(parseGlossary(g), null, 2) + '\n');
}

/** 프로젝트 glossary 파일이 없으면 기본값을 복사하고, 읽어서 돌려준다 */
export function ensureProjectGlossary(file: string): Glossary {
  if (!existsSync(file)) {
    mkdirSync(dirname(file), { recursive: true });
    copyFileSync(DEFAULT_GLOSSARY_FILE, file);
  }
  return loadGlossary(file);
}

/**
 * 별칭 추가 (불변 — 새 Glossary 반환). canonical이 없으면 새 항목을 만든다.
 * 다른 canonical에 이미 묶인 별칭이면 예외.
 */
export function addAlias(g: Glossary, canonical: string, alias: string): Glossary {
  CanonicalWordSchema.parse(canonical);
  const owner = glossaryIndex(g).lookup(alias);
  if (owner === canonical) return g;
  if (owner !== undefined) throw new Error(`별칭 "${alias}"는 이미 ${owner}에 등록되어 있습니다`);
  const has = g.terms.some((t) => t.canonical === canonical);
  const terms = has
    ? g.terms.map((t) => (t.canonical === canonical ? { ...t, aliases: [...t.aliases, alias] } : t))
    : [...g.terms, { canonical, aliases: [alias] }];
  return parseGlossary({ ...g, terms });
}

/** 여러 단어 → 영문 이름 확정 (Lock 단계 사용자 응답 반영) */
export function addTerms(g: Glossary, words: Record<string, string>): Glossary {
  let out = g;
  for (const [alias, canonical] of Object.entries(words)) out = addAlias(out, canonical, alias);
  return out;
}
