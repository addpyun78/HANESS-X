// C4.2·C4.4 로컬 대체판(외부 도구 knip·madge를 pnpm dlx로 받아 실행하는 것은 자동 모드가 '외부 코드'로 막음)
// 이미 설치된 TypeScript 컴파일러로 불러오기(import) 그래프를 만들어:
//  - 안 쓰는 파일: 진입점(각 패키지 index·main·cli·bin, 테스트, scripts, dynamic-entries.json 전부)에서 닿지 않는 src 파일
//  - 안 쓰는 export: 다른 파일 어디서도 그 이름으로 불러오지 않는 export (export * 재내보내기는 따라감)
//  - 안 쓰는 의존성: package.json dependencies 중 그 패키지 파일 어디서도 불러오지 않는 것
//  - 순환 의존: 파일 단위 강한 연결 요소(Tarjan)
// usage: node scripts/audit/deadcode.mjs [--out-suffix .after]
//  → raw/knip.json (knip과 비슷한 모양) · raw/madge-circular.txt
import { createRequire } from 'node:module';
import { join, dirname, relative } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { auditDir, rawDir, readJson, root, sh, writeFileSync, writeJson } from './lib.mjs';

const require = createRequire(join(root, 'package.json'));
const ts = require('typescript');
const suffix = process.argv.includes('--out-suffix')
  ? process.argv[process.argv.indexOf('--out-suffix') + 1]
  : '';
const tracked = sh('git ls-files').split('\n').filter(Boolean);
const CODE = /\.(ts|tsx|mjs|js)$/;
const files = tracked.filter(
  (f) =>
    CODE.test(f) &&
    !f.endsWith('.d.ts') &&
    !f.includes('/dist/') &&
    !f.startsWith('docs/') &&
    !f.includes('/templates/') &&
    !f.includes('src-tauri/'),
);
const fileSet = new Set(files);
// 워크스페이스 패키지 이름 → 폴더
const pkgs = tracked
  .filter((f) => f.endsWith('package.json'))
  .map((f) => ({
    dir: dirname(f) === '.' ? '' : dirname(f),
    json: JSON.parse(readFileSync(join(root, f), 'utf8')),
  }));
const byName = new Map(pkgs.filter((p) => p.json.name).map((p) => [p.json.name, p]));
const pkgOf = (f) =>
  pkgs.filter((p) => p.dir && f.startsWith(p.dir + '/')).sort((a, b) => b.dir.length - a.dir.length)[0] ??
  pkgs.find((p) => p.dir === '');

function resolveSpec(from, spec) {
  if (spec.startsWith('.')) {
    const base = join(dirname(from), spec).split('\\').join('/');
    const cands = [
      base,
      base.replace(/\.(m?js)$/, '.ts'),
      base.replace(/\.js$/, '.tsx'),
      base + '.ts',
      base + '.tsx',
      base + '.mjs',
      base + '.js',
      base + '/index.ts',
      base + '/index.tsx',
      base + '/index.mjs',
    ];
    return cands.find((c) => fileSet.has(c)) ?? null;
  }
  const m = spec.match(/^(@[^/]+\/[^/]+|[^/]+)(\/.*)?$/);
  const p = m && byName.get(m[1]);
  if (!p) return null;
  if (!m[2]) return [`${p.dir}/src/index.ts`, `${p.dir}/src/index.tsx`].find((c) => fileSet.has(c)) ?? null;
  const sub = m[2].replace(/^\//, '');
  const cands = [
    `${p.dir}/src/${sub}.ts`,
    `${p.dir}/src/${sub}/index.ts`,
    `${p.dir}/${sub}`,
    `${p.dir}/src/${sub.replace(/\.js$/, '.ts')}`,
  ];
  return cands.find((c) => fileSet.has(c)) ?? null;
}

// 파일마다: 불러오는 대상(이름 포함), export 이름, 바깥 패키지 이름
const info = new Map();
for (const f of files) {
  const text = readFileSync(join(root, f), 'utf8');
  const sf = ts.createSourceFile(
    f,
    text,
    ts.ScriptTarget.Latest,
    true,
    f.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const imports = []; // {target, names: Set|'*'}
  const exports = new Set();
  const reexportAll = [];
  const externals = new Set();
  const addImport = (spec, names) => {
    const t = resolveSpec(f, spec);
    if (t) imports.push({ target: t, names });
    else if (!spec.startsWith('.') && !spec.startsWith('node:'))
      externals.add(spec.match(/^(@[^/]+\/[^/]+|[^/]+)/)[1]);
  };
  const visit = (n) => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)) {
      const c = n.importClause;
      let names = new Set();
      if (!c) names = '*';
      else {
        if (c.name) names.add('default');
        if (c.namedBindings) {
          if (ts.isNamespaceImport(c.namedBindings)) names = '*';
          else for (const e of c.namedBindings.elements) names.add((e.propertyName ?? e.name).text);
        }
      }
      addImport(n.moduleSpecifier.text, names);
    } else if (ts.isExportDeclaration(n)) {
      if (n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) {
        if (!n.exportClause) {
          reexportAll.push(n.moduleSpecifier.text);
          addImport(n.moduleSpecifier.text, new Set());
        } else if (ts.isNamedExports(n.exportClause)) {
          const names = new Set(n.exportClause.elements.map((e) => (e.propertyName ?? e.name).text));
          addImport(n.moduleSpecifier.text, names);
          for (const e of n.exportClause.elements) exports.add(e.name.text);
        } else addImport(n.moduleSpecifier.text, '*');
      } else if (n.exportClause && ts.isNamedExports(n.exportClause))
        for (const e of n.exportClause.elements) exports.add(e.name.text);
    } else if (
      ts.isCallExpression(n) &&
      (n.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(n.expression) && n.expression.text === 'require')) &&
      n.arguments[0] &&
      ts.isStringLiteralLike(n.arguments[0])
    ) {
      addImport(n.arguments[0].text, '*');
    } else if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'vi') {
      /* vi.mock 등은 아래 문자열 검사로 */
    }
    const mods = ts.canHaveModifiers?.(n) ? ts.getModifiers(n) : undefined;
    if (mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
      const isDefault = mods.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);
      if (isDefault) exports.add('default');
      else if (n.name && ts.isIdentifier(n.name)) exports.add(n.name.text);
      else if (ts.isVariableStatement(n))
        for (const d of n.declarationList.declarations) if (ts.isIdentifier(d.name)) exports.add(d.name.text);
    }
    if (ts.isExportAssignment(n)) exports.add('default');
    ts.forEachChild(n, visit);
  };
  visit(sf);
  // vi.mock('../x.js') · 문자열로 가리키는 상대 경로 모듈(동적 로딩)
  for (const m of text.matchAll(/vi\.mock\(\s*['"]([^'"]+)['"]/g)) addImport(m[1], '*');
  info.set(f, { imports, exports, reexportAll, externals });
}

// 진입점
const dyn = readJson(join(auditDir, 'dynamic-entries.json'), { entries: [] }).entries.map((e) => e.path);
const isEntry = (f) =>
  /\.test\.(ts|tsx)$/.test(f) ||
  /^(scripts|tests|e2e|examples)\//.test(f) ||
  /(^|\/)(vitest|vite|eslint|tauri)\.config\.(ts|js|mjs)$/.test(f) ||
  /\/src\/(index|main|cli|bin)\.(ts|tsx)$/.test(f) ||
  /\/test\/.*helpers?\.(ts|tsx)$/.test(f) ||
  dyn.includes(f) ||
  pkgs.some((p) => {
    const j = p.json;
    const vals = [
      j.main,
      j.module,
      typeof j.bin === 'string' ? j.bin : Object.values(j.bin ?? {}),
      Object.values(j.exports ?? {}),
    ]
      .flat(3)
      .filter((v) => typeof v === 'string');
    return vals.some(
      (v) =>
        `${p.dir}/${v
          .replace(/^\.\//, '')
          .replace(/^dist\//, 'src/')
          .replace(/\.js$/, '.ts')}` === f,
    );
  });
const entries = files.filter(isEntry);
// 닿는 파일
const reach = new Set();
const stack = [...entries];
while (stack.length) {
  const f = stack.pop();
  if (reach.has(f)) continue;
  reach.add(f);
  for (const i of info.get(f)?.imports ?? []) stack.push(i.target);
}
const unusedFiles = files.filter((f) => !reach.has(f) && /\/src\//.test(f));

// 쓰는 export: 불러오는 쪽 이름(재내보내기 따라감)
const used = new Map(files.map((f) => [f, new Set()]));
const markAll = (f, seen = new Set()) => {
  if (seen.has(f)) return;
  seen.add(f);
  const i = info.get(f);
  if (!i) return;
  used.get(f).add('*');
  for (const r of i.reexportAll) {
    const t = resolveSpec(f, r);
    if (t) markAll(t, seen);
  }
};
const markName = (f, name, seen = new Set()) => {
  const key = f + '#' + name;
  if (seen.has(key)) return;
  seen.add(key);
  const i = info.get(f);
  if (!i) return;
  used.get(f).add(name);
  for (const imp of i.imports) if (imp.names !== '*' && imp.names.has(name)) markName(imp.target, name, seen); // export { x } from
  for (const r of i.reexportAll) {
    const t = resolveSpec(f, r);
    if (t) markName(t, name, seen);
  }
};
for (const [, i] of info)
  for (const imp of i.imports) {
    if (imp.names === '*') markAll(imp.target);
    else for (const n of imp.names) markName(imp.target, n);
  }
const unusedExports = [];
for (const f of files) {
  if (!/\/src\//.test(f) || isEntry(f) || !reach.has(f)) continue;
  const u = used.get(f);
  if (u.has('*')) continue;
  for (const e of info.get(f).exports) if (!u.has(e)) unusedExports.push({ file: f, name: e });
}
// 안 쓰는 의존성
const unusedDeps = [];
for (const p of pkgs) {
  const deps = Object.keys(p.json.dependencies ?? {});
  if (!deps.length) continue;
  const mine = files.filter((f) =>
    p.dir ? f.startsWith(p.dir + '/') : !pkgs.some((q) => q.dir && f.startsWith(q.dir + '/')),
  );
  const ext = new Set(mine.flatMap((f) => [...(info.get(f)?.externals ?? [])]));
  const internal = new Set(
    mine.flatMap((f) => (info.get(f)?.imports ?? []).map((i) => pkgOf(i.target)?.json.name)).filter(Boolean),
  );
  const textAll = mine.map((f) => readFileSync(join(root, f), 'utf8')).join('\n');
  for (const d of deps) {
    if (ext.has(d) || internal.has(d)) continue;
    if (textAll.includes(`'${d}'`) || textAll.includes(`"${d}"`) || textAll.includes(`${d}/`)) continue; // 문자열·하위 경로로 쓰는 경우
    // 빌드 도구·타입·설정 파일이 쓰는 것
    const cfg = ['vite.config.ts', 'tsconfig.json', 'index.html']
      .map((c) => (p.dir ? `${p.dir}/${c}` : c))
      .filter((c) => existsSync(join(root, c)))
      .map((c) => readFileSync(join(root, c), 'utf8'))
      .join('\n');
    if (cfg.includes(d)) continue;
    unusedDeps.push({ package: p.json.name ?? '(root)', dir: p.dir || '.', dependency: d });
  }
}
// 순환 의존 (Tarjan)
let idx = 0;
const index = new Map();
const low = new Map();
const onStack = new Set();
const st = [];
const cycles = [];
const strong = (v) => {
  index.set(v, idx);
  low.set(v, idx++);
  st.push(v);
  onStack.add(v);
  for (const { target: w } of info.get(v)?.imports ?? []) {
    if (!index.has(w)) {
      strong(w);
      low.set(v, Math.min(low.get(v), low.get(w)));
    } else if (onStack.has(w)) low.set(v, Math.min(low.get(v), index.get(w)));
  }
  if (low.get(v) === index.get(v)) {
    const comp = [];
    let w;
    do {
      w = st.pop();
      onStack.delete(w);
      comp.push(w);
    } while (w !== v);
    if (comp.length > 1) cycles.push(comp.sort());
  }
};
for (const f of files.filter((f) => !/\.test\./.test(f))) if (!index.has(f)) strong(f);

writeJson(join(rawDir, `knip${suffix}.json`), {
  tool: 'scripts/audit/deadcode.mjs (knip 대체, TypeScript 컴파일러 기반)',
  entries: entries.length,
  filesScanned: files.length,
  files: unusedFiles,
  exports: unusedExports,
  dependencies: unusedDeps,
});
writeFileSync(
  join(rawDir, `madge-circular${suffix}.txt`),
  `# 순환 의존 (scripts/audit/deadcode.mjs, madge 대체 — 파일 단위 강한 연결 요소)\n# 순환 묶음 ${cycles.length}개\n` +
    cycles.map((c, i) => `${i + 1}) ${c.join(' > ')}`).join('\n') +
    '\n',
);
console.log(
  `deadcode: 파일 ${files.length}개·진입점 ${entries.length}개 → 안 쓰는 파일 ${unusedFiles.length}, 안 쓰는 export ${unusedExports.length}, 안 쓰는 의존성 ${unusedDeps.length}, 순환 묶음 ${cycles.length}`,
);
void relative;
