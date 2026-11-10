import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compilePlugin } from '../src/check.js';
import { buildInstallCard, installPlugin, lineDiff, type InstallCard } from '../src/install.js';
import { KOTLIN_HOOK_OK } from './fixtures/kotlin-hook.js';
import { kotlinSpec, samplePlugin } from './fixtures/plugins.js';

/** 스냅샷용: 임시 경로 지우기, 템플릿·빌드 파일은 목록만 */
function stable(card: InstallCard, home: string) {
  return {
    ...card,
    target: card.target.replace(home, '<home>').split('\\').join('/'),
    files: card.files.map((f) => ({
      path: f.path,
      change: f.change,
      ...(f.path === 'src/index.ts' && f.diff ? { diff: f.diff } : {}),
    })),
  };
}

describe('52.4 설치 카드 (파일 diff, 권한 요약, 네트워크·셸 빨간 경고)', () => {
  it('첫 설치 카드 + 다시 설치 카드(diff) 스냅샷', () => {
    const home = mkdtempSync(join(tmpdir(), 'hx-forge-card-'));
    const spec = kotlinSpec({ permissions: { fs: [], net: ['api.github.com'], shell: true } });
    const p = samplePlugin(spec, { 'src/index.ts': KOTLIN_HOOK_OK });
    try {
      expect(compilePlugin(p.dir, { emit: true }).ok).toBe(true);
      const first = buildInstallCard(p.dir, { home });
      expect(first.warnings.map((w) => [w.kind, w.level])).toEqual([
        ['net', 'danger'],
        ['shell', 'danger'],
      ]);
      expect(first).toMatchObject({ update: false, trust: 'unsigned-isolated', trustLabel: '미서명·격리' });
      expect(first.files.every((f) => f.change === 'create')).toBe(true);
      expect(first.files.find((f) => f.path === 'dist/index.js')).toEqual({
        path: 'dist/index.js',
        change: 'create',
      });
      expect(
        stable({ ...first, files: first.files.filter((f) => !f.path.startsWith('src/')) }, home),
      ).toMatchSnapshot('first-install');

      installPlugin(p.dir, { home });
      writeFileSync(
        join(p.dir, 'src/index.ts'),
        KOTLIN_HOOK_OK.replace(
          "const LINT = ['./gradlew', 'ktlintCheck'];",
          "const LINT = ['./gradlew', 'ktlintCheck', '--continue'];",
        ),
      );
      const again = buildInstallCard(p.dir, { home });
      expect(again.update).toBe(true);
      expect(stable(again, home)).toMatchSnapshot('reinstall');
      expect(again.files.find((f) => f.path === 'src/index.ts')!.diff).toContain(
        "+const LINT = ['./gradlew', 'ktlintCheck', '--continue'];",
      );
    } finally {
      p.cleanup();
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('권한 없는 플러그인은 경고 없음', () => {
    const home = mkdtempSync(join(tmpdir(), 'hx-forge-card-'));
    const spec = kotlinSpec({ permissions: { fs: [], net: [], shell: false } });
    const p = samplePlugin(spec);
    try {
      const card = buildInstallCard(p.dir, { home });
      expect(card.warnings).toEqual([]);
      expect(card.permissionSummary).toEqual(['권한 없음']);
    } finally {
      p.cleanup();
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('lineDiff', () => {
    expect(lineDiff('a\nb\nc\n', 'a\nB\nc\n')).toBe(' a\n-b\n+B\n c');
  });
});
