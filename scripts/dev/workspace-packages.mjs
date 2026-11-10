import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/** packages/ 아래 3단계까지, apps/* 중 src/index.ts가 있는 @harness-x/* 패키지 */
export function listWorkspacePackages(root = process.cwd()) {
  const out = [];
  const visit = (dir, depth) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      const d = join(dir, name);
      if (name === 'node_modules' || !statSync(d).isDirectory()) continue;
      const pj = join(d, 'package.json');
      if (existsSync(pj)) {
        const pkg = JSON.parse(readFileSync(pj, 'utf8'));
        if (pkg.name?.startsWith('@harness-x/') && existsSync(join(d, 'src', 'index.ts')))
          out.push({ name: pkg.name, dir: d, rel: relative(root, d).split('\\').join('/') });
      } else if (depth > 0) visit(d, depth - 1);
    }
  };
  visit(join(root, 'packages'), 2);
  visit(join(root, 'apps'), 0);
  return out;
}
