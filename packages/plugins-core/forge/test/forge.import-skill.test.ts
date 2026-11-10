import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HookBus, PluginLoader } from '@harness-x/kernel';
import { validateSkillMd } from '@harness-x/sdk';
import { ImportError, importSkillFolder } from '../src/import/index.js';

describe('53.3 표준 SKILL.md 폴더 가져오기', () => {
  it('SKILL.md + 참고 파일 → 스킬 플러그인 → 로드', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'hx-import-skill-'));
    try {
      const src = join(tmp, 'src', 'pdf-forms');
      mkdirSync(join(src, 'scripts'), { recursive: true });
      writeFileSync(
        join(src, 'SKILL.md'),
        '---\nname: pdf-forms\ndescription: PDF 양식 채우기 절차\nlicense: MIT\n---\n\n# PDF 양식\n\n1. `scripts/fill.py`로 채운다.\n',
      );
      writeFileSync(join(src, 'scripts', 'fill.py'), 'print("fill")\n');
      writeFileSync(join(src, 'REFERENCE.md'), '# 참고\n');

      const root = join(tmp, 'plugins');
      const r = importSkillFolder(src, join(root, 'pdf-forms'));
      expect(r.manifest).toMatchObject({
        id: 'pdf-forms',
        description: 'PDF 양식 채우기 절차',
        provides: { skill: ['pdf-forms'] },
        permissions: { fs: [], net: [], shell: false },
        main: 'harness-index.js',
      });
      for (const f of ['SKILL.md', 'scripts/fill.py', 'REFERENCE.md'])
        expect(existsSync(join(root, 'pdf-forms', f)), f).toBe(true);
      expect(validateSkillMd(readFileSync(join(root, 'pdf-forms', 'SKILL.md'), 'utf8')).ok).toBe(true);

      const lines: string[] = [];
      const loader = new PluginLoader({
        hooks: new HookBus(),
        roots: [{ dir: root, origin: 'user' }],
        lockFile: join(tmp, 'plugins.lock'),
        logger: (l) => lines.push(l),
      });
      expect(await loader.loadAll()).toEqual(['pdf-forms']);
      const p = loader.plugins.get('pdf-forms')!;
      expect(p.state).toBe('active');
      expect((p.module as { skill?: unknown }).skill).toEqual({
        name: 'pdf-forms',
        description: 'PDF 양식 채우기 절차',
        file: 'SKILL.md',
      });
      expect(lines).toContain('[pdf-forms] skill pdf-forms ready (SKILL.md)');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('프런트매터가 깨진 SKILL.md는 거부', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'hx-import-skill-'));
    try {
      writeFileSync(join(tmp, 'SKILL.md'), '---\ndescription: 이름 없음\n---\n본문\n');
      expect(() => importSkillFolder(tmp, join(tmp, 'out'))).toThrow(/name은 필수/);
      expect(() => importSkillFolder(join(tmp, 'none'), join(tmp, 'out'))).toThrow(ImportError);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
