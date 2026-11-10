import { describe, expect, it } from 'vitest';
import { runChecks } from '../src/check.js';
import { KOTLIN_HOOK_OK } from './fixtures/kotlin-hook.js';
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

describe('52.2 권한 최소화 린트', () => {
  it('선언했지만 안 쓰는 권한 → 제거 제안 (fs·net), 쓰는 shell은 유지', () => {
    const spec = kotlinSpec({
      permissions: { fs: ['workspace:write'], net: ['api.example.com'], shell: true },
    });
    withPlugin(spec, undefined, (dir) => {
      const r = runChecks(dir, spec);
      expect(r.ok).toBe(true); // 제안은 실패가 아니다
      expect(r.suggestions.map((s) => [s.permission, s.suggested])).toEqual([
        ['net', []],
        ['fs', []],
      ]);
      expect(r.suggestions[0]!.message).toMatch(/api\.example\.com.*쓰지 않음 — 제거하세요/);
      expect(r.minimized).toEqual({ fs: [], net: [], shell: true });
    });
  });

  it('쓰지 않는 셸 권한 → 제거 제안, 쓰는데 선언 안 한 권한 → 오류', () => {
    const allow = `export function activate(ctx: { log(m: string): void }): void { ctx.log('hi'); }\n`;
    withPlugin(kotlinSpec(), { 'src/index.ts': allow }, (dir) => {
      const r = runChecks(dir, kotlinSpec());
      expect(r.suggestions).toEqual([
        expect.objectContaining({ permission: 'shell', declared: true, suggested: false }),
      ]);
    });
    const noShell = kotlinSpec({ permissions: { fs: [], net: [], shell: false } });
    withPlugin(noShell, undefined, (dir) => {
      const r = runChecks(dir, noShell);
      expect(r.ok).toBe(false);
      expect(r.errors).toEqual([
        expect.objectContaining({ kind: 'permission', message: expect.stringMatching(/ctx\.shell/) }),
      ]);
    });
  });
});
