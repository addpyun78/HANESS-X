// T-102 E.C1-010.1 재현: dist가 새것이면 cli 테스트가 다시 빌드하지 않는다(동시 다시 빌드로 생기던 흔들림 방지)
import { mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isStale } from './ensure-built.js';
import { tempDir } from './helpers.js';

describe('ensureBuilt (T-102 C1-010)', () => {
  it('dist가 src보다 새것이면 다시 빌드할 필요 없음, src가 더 새것이면 필요', () => {
    const t = tempDir('hx-built-');
    try {
      mkdirSync(join(t.dir, 'src'));
      mkdirSync(join(t.dir, 'dist'));
      writeFileSync(join(t.dir, 'src', 'a.ts'), 'x');
      writeFileSync(join(t.dir, 'dist', 'cli.js'), 'x');
      const old = Date.now() / 1000 - 100;
      utimesSync(join(t.dir, 'src', 'a.ts'), old, old);
      expect(isStale(t.dir)).toBe(false);
      utimesSync(join(t.dir, 'src', 'a.ts'), old + 200, old + 200);
      expect(isStale(t.dir)).toBe(true);
    } finally {
      t.cleanup();
    }
  });
});
