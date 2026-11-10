import { describe, expect, it } from 'vitest';
import { parseSkillMd, validateSkillMd } from '../src/skill-md.js';
import { renderTemplate } from '../src/templates.js';

describe('50.3 SKILL.md 프런트매터 검증기', () => {
  it('정상 파일 통과, 본문 분리', () => {
    const r = validateSkillMd(
      '---\nname: commit-guard\ndescription: 커밋 전 검사\nlicense: MIT\n---\n# 본문\n',
    );
    expect(r).toMatchObject({ ok: true, errors: [], body: '# 본문\n' });
    expect(r.frontmatter).toMatchObject({
      name: 'commit-guard',
      description: '커밋 전 검사',
      license: 'MIT',
    });
  });

  it('스킬 템플릿 렌더링 결과가 통과', () => {
    const files = renderTemplate('skill', {
      id: 'my-skill',
      displayName: '내 스킬',
      description: '시험: "따옴표"',
    });
    expect(parseSkillMd(files['SKILL.md']!).frontmatter).toMatchObject({
      name: 'my-skill',
      description: '시험: "따옴표"',
    });
  });

  it('name 누락 시 오류', () => {
    const r = validateSkillMd('---\ndescription: 설명만\n---\n');
    expect(r.ok).toBe(false);
    expect(r.errors).toEqual(['name: name은 필수']);
  });

  it('description 누락·빈 값 시 오류', () => {
    expect(validateSkillMd('---\nname: a\n---\n').errors).toEqual(['description: description은 필수']);
    expect(validateSkillMd('---\nname: a\ndescription: "  "\n---\n').errors).toEqual([
      'description: description은 필수',
    ]);
  });

  it('둘 다 누락·프런트매터 없음·잘못된 YAML·잘못된 이름', () => {
    expect(validateSkillMd('---\ntitle: x\n---\n').errors).toHaveLength(2);
    expect(validateSkillMd('# 그냥 마크다운\n').errors).toEqual(['프런트매터(--- ... ---)가 없음']);
    expect(validateSkillMd('---\nname: [a\n---\n').errors[0]).toMatch(/YAML 오류/);
    expect(validateSkillMd('---\nname: My Skill\ndescription: d\n---\n').errors[0]).toMatch(/kebab-case/);
    expect(() => parseSkillMd('---\nname: a\n---\n')).toThrow(/description은 필수/);
  });
});
