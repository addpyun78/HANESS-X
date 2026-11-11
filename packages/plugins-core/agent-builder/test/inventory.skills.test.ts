import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectSkills, readSkillFrontmatter } from '../src/inventory/skills.js';
import { extractTags } from '../src/inventory/text.js';
import { inventoryEnv, skillMd } from './inventory-helpers.js';

describe('P4-A.3 스킬 수집 (프런트매터만)', () => {
  it('스킬 수 일치 + 이름·설명·소속 플러그인·태그, 본문 미포함', async () => {
    const env = inventoryEnv();
    try {
      const userSkills = join(env.home, 'skills');
      mkdirSync(join(userSkills, 'my-notes'), { recursive: true });
      writeFileSync(join(userSkills, 'my-notes', 'SKILL.md'), skillMd('my-notes', '임장노트 메모 정리'));
      const loader = env.loader();
      await loader.loadAll();
      const skills = collectSkills(loader.plugins.values(), { skillRoots: [userSkills] });
      const declared = [...loader.plugins.values()].reduce(
        (n, p) => n + (p.manifest.provides.skill?.length ?? 0),
        0,
      );
      expect(skills).toHaveLength(declared + 1);
      expect(skills.map((s) => s.id).sort()).toEqual(['compose-ui', 'kotlin-style', 'my-notes', 'ui-audit']);
      const k = skills.find((s) => s.id === 'kotlin-style')!;
      expect(k).toMatchObject({
        name: 'kotlin-style',
        description: 'Kotlin 코드 스타일 규칙 (ktlint 기준)',
        pluginId: 'kotlin-skills',
        health: 'ready',
      });
      expect(k.tags).toEqual(expect.arrayContaining(['kotlin', '코드', '스타일', 'ktlint']));
      expect(skills.find((s) => s.id === 'ui-audit')!.pluginId).toBe('ui-audit'); // 플러그인 루트 SKILL.md
      expect(skills.find((s) => s.id === 'my-notes')!.pluginId).toBeUndefined();
      const json = JSON.stringify(skills);
      expect(json).not.toContain('BODY-MARKER');
      expect(json).not.toContain('# 본문');
    } finally {
      env.cleanup();
    }
  });

  it('프런트매터 없음·깨짐 → 빈 값, 본문은 읽지 않음', () => {
    const env = inventoryEnv();
    try {
      const f = join(env.dir, 'SKILL.md');
      writeFileSync(f, '# 프런트매터 없음\nname: 가짜\n');
      expect(readSkillFrontmatter(f)).toEqual({});
      writeFileSync(f, '---\nname: [깨짐\n---\n');
      expect(readSkillFrontmatter(f)).toEqual({});
      writeFileSync(f, `---\nname: ok\ndescription: 설명\n---\n${'x'.repeat(100_000)}`);
      expect(readSkillFrontmatter(f)).toEqual({ name: 'ok', description: '설명' });
      expect(readSkillFrontmatter(join(env.dir, 'none.md'))).toEqual({});
    } finally {
      env.cleanup();
    }
  });

  it('태그: 조사·불용어 제거, 중복 없음', () => {
    expect(extractTags('화면을 검사하는 스킬과 화면 the UI audit for UI')).toEqual([
      '화면',
      '검사',
      '스킬',
      'ui',
      'audit',
    ]);
  });
});
