// T-102 C1-010: cli 테스트가 시작할 때마다 `pnpm run build`로 dist를 다시 만들면, 같은 시각 dist를 쓰는 다른 테스트가
// 반쯤 만들어진 파일을 읽어 깨진다(SyntaxError). → dist가 src보다 새것이면 다시 만들지 않는다.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function newest(dir: string, ext: RegExp): number {
  let t = 0;
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (ext.test(e.name)) t = Math.max(t, statSync(p).mtimeMs);
    }
  };
  if (existsSync(dir)) walk(dir);
  return t;
}

/** dist가 없거나 src보다 오래됐으면 true */
export function isStale(pkgDir: string): boolean {
  const dist = join(pkgDir, 'dist', 'cli.js');
  if (!existsSync(dist)) return true;
  return newest(join(pkgDir, 'src'), /\.ts$/) > newest(join(pkgDir, 'dist'), /\.js$/);
}

/** 필요할 때만 빌드. 빌드했으면 true */
export function ensureBuilt(pkgDir: string): boolean {
  if (!isStale(pkgDir)) return false;
  execFileSync('pnpm', ['run', 'build'], { cwd: pkgDir, stdio: 'ignore' });
  return true;
}
