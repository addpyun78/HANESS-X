import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_GLOSSARY_FILE,
  GlossarySchema,
  addAlias,
  ensureProjectGlossary,
  glossaryIndex,
  loadDefaultGlossary,
} from '../src/glossary.js';
import { toCanonicalPath } from '../src/naming.js';
import { tempDir } from './helpers.js';

describe('22.5 프로젝트 glossary.json 기본값', () => {
  let cleanup = () => {};
  afterEach(() => cleanup());

  it('파일 존재·스키마 통과·20개', () => {
    expect(existsSync(DEFAULT_GLOSSARY_FILE)).toBe(true);
    const raw = JSON.parse(readFileSync(DEFAULT_GLOSSARY_FILE, 'utf8'));
    const g = GlossarySchema.parse(raw);
    expect(g.terms).toHaveLength(20);
    const idx = glossaryIndex(g);
    expect(idx.lookup('하네스')).toBe('harness');
    expect(idx.lookup('모바일')).toBe('mobile');
    expect(idx.lookup('에이전트')).toBe('agent');
    expect(idx.lookup('하네스'.normalize('NFD'))).toBe('harness');
    expect(toCanonicalPath('하네스/모바일', g).path).toBe('harness/mobile');
  });

  it('프로젝트로 복사(없을 때만)', () => {
    const t = tempDir();
    cleanup = t.cleanup;
    const file = join(t.dir, '.harness-x', 'glossary.json');
    expect(ensureProjectGlossary(file)).toEqual(loadDefaultGlossary());
    expect(existsSync(file)).toBe(true);
  });

  it('별칭 추가·중복 거부', () => {
    const g = loadDefaultGlossary();
    const g2 = addAlias(g, 'harness', 'ai');
    expect(glossaryIndex(g2).lookup('AI')).toBe('harness');
    expect(glossaryIndex(g).lookup('ai')).toBeUndefined();
    expect(() => addAlias(g, 'mobile', '하네스')).toThrow();
    expect(
      GlossarySchema.safeParse({
        version: 1,
        terms: [
          { canonical: 'a', aliases: ['가'] },
          { canonical: 'b', aliases: ['가'] },
        ],
      }).success,
    ).toBe(false);
    expect(
      GlossarySchema.safeParse({ version: 1, terms: [{ canonical: 'Bad Word', aliases: ['x'] }] }).success,
    ).toBe(false);
  });
});
