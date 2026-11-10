import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { PluginManifestSchema, parseAgentYaml, parsePipelineYaml } from '@harness-x/protocol';
import { TEMPLATE_KINDS, listTemplates, scaffold } from '../src/templates.js';

// 스캐폴드한 패키지는 node_modules가 없으므로 저장소의 tsc를 PATH로 빌려 쓴다
const REPO_BIN = fileURLToPath(new URL('../../../node_modules/.bin', import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'hx-templates-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('50.1 템플릿 5종 골격', () => {
  it('레지스트리: skill, tool, hook, pipeline, panel', () => {
    expect(listTemplates().map((t) => t.kind)).toEqual(['skill', 'tool', 'hook', 'pipeline', 'panel']);
    for (const t of listTemplates()) {
      expect(t.files).toEqual(
        expect.arrayContaining(['harness-plugin.json', 'package.json', 'tsconfig.json', 'src/index.ts']),
      );
      expect(t.files).not.toContain('template.json');
    }
  });

  it.each(TEMPLATE_KINDS)(
    '%s: 스캐폴드 후 pnpm build exit 0',
    (kind) => {
      const dest = join(tmp, kind);
      const id = `my-${kind}`;
      scaffold(kind, dest, {
        id,
        displayName: `내 ${kind}`,
        description: `"${kind}" 템플릿 시험: 따옴표·콜론: 포함`,
        permissions: { fs: ['workspace:read'], net: [], shell: false },
      });
      const manifest = PluginManifestSchema.parse(
        JSON.parse(readFileSync(join(dest, 'harness-plugin.json'), 'utf8')),
      );
      expect(manifest).toMatchObject({ id, main: 'dist/index.js', provides: { [kind]: [id] } });
      expect(manifest.permissions.fs).toEqual(['workspace:read']);

      const r = spawnSync('pnpm', ['build'], {
        cwd: dest,
        encoding: 'utf8',
        env: { ...process.env, PATH: `${REPO_BIN}${delimiter}${process.env.PATH ?? ''}` },
      });
      expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
      expect(existsSync(join(dest, 'dist', 'index.js'))).toBe(true);

      if (kind === 'pipeline') {
        const p = parsePipelineYaml(readFileSync(join(dest, 'pipeline.yaml'), 'utf8'));
        expect(p.name).toBe(id);
        const a = parseAgentYaml(readFileSync(join(dest, 'agent.yaml'), 'utf8'));
        expect(a).toMatchObject({ name: id, command: `/${id}`, displayName: `내 ${kind}` });
      }
    },
    120_000,
  );

  it('비어 있지 않은 대상 폴더 거부', () => {
    expect(() =>
      scaffold('tool', join(tmp, 'tool'), { id: 'again', displayName: 'x', description: 'x' }),
    ).toThrow(/비어 있지 않음/);
  });
});
