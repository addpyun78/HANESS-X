import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateSkillMd } from '@harness-x/sdk';
import { ImportError, js, prepareDest, writePlugin, type ImportResult } from './common.js';

/**
 * T-053 53.3 표준 SKILL.md 폴더 가져오기
 * <폴더>/SKILL.md (프런트매터 name·description 필수) + 참고 파일·스크립트 → 하네스 스킬 플러그인
 * 폴더 내용은 그대로 복사하고, 매니페스트(provides.skill = [name])와 진입 모듈(skill 메타·SKILL.md 본문 읽기)을 만든다.
 */

export function skillPluginMain(skill: { name: string; description: string }): string {
  return `// 생성됨: Forge 가져오기 (SKILL.md 폴더 → 하네스 스킬 플러그인)
export const skill = ${js({ ...skill, file: 'SKILL.md' })};

export function activate(ctx) {
  ctx.log('skill ' + skill.name + ' ready (' + skill.file + ')');
}

export function deactivate() {}
`;
}

export function importSkillFolder(src: string, dest: string, opts: { id?: string } = {}): ImportResult {
  const file = join(src, 'SKILL.md');
  if (!existsSync(file)) throw new ImportError(`SKILL.md 없음: ${src}`);
  const v = validateSkillMd(readFileSync(file, 'utf8'));
  if (!v.ok) throw new ImportError(`SKILL.md 검증 실패: ${v.errors.join('; ')}`);
  const { name, description } = v.frontmatter!;
  prepareDest(src, dest);
  const manifest = writePlugin(
    dest,
    {
      id: opts.id ?? name,
      version: '0.1.0',
      apiVersion: 1,
      displayName: name,
      description,
      provides: { skill: [name] },
      permissions: { fs: [], net: [], shell: false },
    },
    skillPluginMain({ name, description }),
  );
  return { dir: dest, manifest, warnings: [] };
}
