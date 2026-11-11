import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setup } from './fixtures.js';

/** 플러그인 폴더 하나 만들기 (매니페스트 + 빈 index.js) */
export function writePlugin(
  root: string,
  manifest: Record<string, unknown>,
  files: Record<string, string> = {},
) {
  const dir = join(root, String(manifest.id));
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'harness-plugin.json'),
    JSON.stringify({ version: '0.1.0', apiVersion: 1, ...manifest }),
  );
  writeFileSync(join(dir, 'index.js'), 'export function activate() {}\n');
  for (const [rel, text] of Object.entries(files)) {
    const f = join(dir, rel);
    mkdirSync(join(f, '..'), { recursive: true });
    writeFileSync(f, text);
  }
  return dir;
}

export const skillMd = (name: string, description: string, body = '# 본문\n\nBODY-MARKER 비밀 본문\n') =>
  `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n\n${body}`;

/** hello + design-qa 파이프라인 + 스킬 플러그인 2개 + mcp-host 모양 플러그인 */
export function inventoryEnv() {
  const env = setup();
  env.copyHello();
  env.copyDesignQaPlugin();
  writePlugin(
    env.pluginRoot,
    {
      id: 'kotlin-skills',
      displayName: 'Kotlin 스킬',
      description: 'Kotlin·Compose 스킬 묶음',
      provides: { skill: ['kotlin-style', 'compose-ui'] },
      permissions: { fs: ['workspace:read'], net: [], shell: false },
    },
    {
      'skills/kotlin-style/SKILL.md': skillMd('kotlin-style', 'Kotlin 코드 스타일 규칙 (ktlint 기준)'),
      'skills/compose-ui/SKILL.md': skillMd('compose-ui', 'Jetpack Compose 화면 디자인 토큰 점검'),
    },
  );
  writePlugin(
    env.pluginRoot,
    {
      id: 'ui-audit',
      description: '화면 접근성 검사 스킬',
      provides: { skill: ['ui-audit'], command: ['/ui-audit'] },
    },
    { 'SKILL.md': skillMd('ui-audit', '화면 접근성·대비 검사') },
  );
  writePlugin(env.pluginRoot, {
    id: 'mcp-host',
    displayName: 'Harness MCP Host',
    description: '체크리스트 MCP 도구',
    provides: { tool: ['mcp-host'] },
    permissions: { fs: ['workspace:read', 'workspace:write'], net: ['127.0.0.1'], shell: false },
  });
  writePlugin(env.pluginRoot, {
    id: 'shot-tool',
    description: '스크린샷 찍기 도구',
    provides: { tool: ['screenshot'] },
    permissions: { fs: ['workspace:write'], net: [], shell: true },
  });
  return env;
}
