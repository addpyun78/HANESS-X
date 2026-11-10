import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runChecks } from '../src/check.js';
import { KOTLIN_HOOK_OK, KOTLIN_HOOK_TYPE_ERROR } from './fixtures/kotlin-hook.js';
import { kotlinSpec, samplePlugin } from './fixtures/plugins.js';

function withPlugin(
  spec = kotlinSpec(),
  files: Record<string, string> = { 'src/index.ts': KOTLIN_HOOK_OK },
  fn: (dir: string) => void,
) {
  const p = samplePlugin(spec, files);
  try {
    fn(p.dir);
  } finally {
    p.cleanup();
  }
}

describe('52.1 매니페스트·타입체크·SKILL.md 검사', () => {
  it('정상 샘플 통과', () => {
    withPlugin(undefined, undefined, (dir) => {
      const r = runChecks(dir, kotlinSpec());
      expect(r.errors).toEqual([]);
      expect(r.ok).toBe(true);
      expect(r.usage).toMatchObject({ shell: true, net: false, fsRead: false, fsWrite: false });
    });
  });

  it('깨진 매니페스트(JSON) 거부', () => {
    withPlugin(undefined, undefined, (dir) => {
      writeFileSync(join(dir, 'harness-plugin.json'), '{ "id": "pr-kotlin-guard", ');
      const r = runChecks(dir, kotlinSpec());
      expect(r.ok).toBe(false);
      expect(r.errors[0]).toMatchObject({ kind: 'manifest', message: expect.stringMatching(/JSON 오류/) });
    });
  });

  it('스키마 위반 매니페스트(provides 없음, id 불일치) 거부', () => {
    withPlugin(undefined, undefined, (dir) => {
      writeFileSync(
        join(dir, 'harness-plugin.json'),
        JSON.stringify({ id: 'Bad Id', version: '0.1.0', apiVersion: 1, provides: {} }),
      );
      const r = runChecks(dir, kotlinSpec());
      expect(r.ok).toBe(false);
      const msgs = r.errors.filter((e) => e.kind === 'manifest').map((e) => e.message);
      expect(msgs.some((m) => m.startsWith('id:'))).toBe(true);
      expect(msgs.some((m) => m.startsWith('provides'))).toBe(true);
    });
  });

  it('타입 오류 본문 거부 (파일:줄 표시)', () => {
    withPlugin(undefined, { 'src/index.ts': KOTLIN_HOOK_TYPE_ERROR }, (dir) => {
      const r = runChecks(dir, kotlinSpec());
      expect(r.ok).toBe(false);
      const te = r.errors.filter((e) => e.kind === 'typecheck');
      expect(te).toHaveLength(1);
      expect(te[0]!.message).toMatch(
        /^src\/index\.ts:\d+:\d+ TS2322: Type 'string' is not assignable to type 'number'/,
      );
    });
  });

  it('SKILL.md 프런트매터 name 누락 거부 (스킬 플러그인)', () => {
    const spec = kotlinSpec({
      id: 'kotlin-lint-skill',
      kind: 'skill',
      trigger: {},
      permissions: { fs: [], net: [], shell: false },
      examples: [{ name: '기본', input: {}, files: {}, expect: {} }],
    });
    withPlugin(spec, { 'SKILL.md': '---\ndescription: 린트 절차\n---\n# 린트\n' }, (dir) => {
      const r = runChecks(dir, spec);
      expect(r.ok).toBe(false);
      expect(r.errors).toEqual([{ kind: 'skill-md', message: 'name: name은 필수', file: 'SKILL.md' }]);
    });
  });
});
