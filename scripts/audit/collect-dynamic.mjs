// B.16~B.21 동적 진입점 수집 (이름·경로로 나중에 불러와서 자동 도구가 "안 쓰는 파일"로 착각하기 쉬운 것)
// usage: node scripts/audit/collect-dynamic.mjs <hooks|mcp|cli|registries|fixtures|merge>
//  hooks      (B.16) 엔진 훅 설정의 스크립트 경로 + 하네스가 주입하는 훅 템플릿 → raw/dyn-hooks.json
//  mcp        (B.17) MCP 도구 구현 파일 → raw/dyn-mcp.json
//  cli        (B.18) CLI 명령 구현 파일 → raw/dyn-cli.json
//  registries (B.19) 템플릿·SKILL.md·비교기·판정기·설치 어댑터 등 이름으로 등록되는 파일 → raw/dyn-registries.json
//  fixtures   (B.20) 테스트 데이터 폴더·녹화 파일 → raw/dyn-fixtures.json
//  merge      (B.21) 위 5개 + raw/dyn-plugins.json → docs/audit/dynamic-entries.json (경로 실존 검사)
// H.12: 플러그인·훅·도구가 늘면 다시 실행하면 같이 늘어난다(전부 저장소 내용에서 다시 계산)
import { join } from 'node:path';
import { auditDir, existsSync, rawDir, readFileSync, readJson, root, sh, writeJson } from './lib.mjs';

// 추적 중 + 아직 커밋 안 한 새 파일(무시 목록 제외)까지 — 플러그인·훅·도구가 늘면 같이 늘어나게(H.12)
const tracked = sh('git ls-files --cached --others --exclude-standard').split('\n').filter(Boolean);
const srcOf = (p) => tracked.filter((f) => f.startsWith(p));
const read = (f) => readFileSync(join(root, f), 'utf8');
const isSrc = (f) => /\/src\/.*\.(ts|tsx|mjs)$/.test(f) && !/\.test\./.test(f) && !f.endsWith('.d.ts');
const mode = process.argv[2];
const save = (name, list) => {
  const uniq = [...new Map(list.map((x) => [x.path, x])).values()].sort((a, b) =>
    a.path.localeCompare(b.path),
  );
  writeJson(join(rawDir, `${name}.json`), uniq);
  console.log(`${name}: ${uniq.length}개`);
};

if (mode === 'hooks') {
  const out = [];
  // 엔진 훅 설정 파일 (.claude/settings*.json, .codex/hooks.json, 플러그인 hooks/hooks.json)
  for (const f of tracked.filter((x) =>
    /(^|\/)\.claude\/settings[^/]*\.json$|(^|\/)\.codex\/hooks\.json$|(^|\/)hooks\/hooks\.json$/.test(x),
  )) {
    out.push({ path: f, kind: 'hook-config' });
    let j;
    try {
      j = JSON.parse(read(f));
    } catch {
      continue;
    }
    for (const arr of Object.values(j.hooks ?? {}))
      for (const h of arr)
        for (const x of h.hooks ?? [h]) {
          const m = String(x.command ?? '').match(/([A-Za-z0-9_./${}-]+\.(?:mjs|js|ts|sh|py))/);
          if (m) {
            const p = m[1].replace(/^\$\{[A-Z_]+\}\//, '');
            const abs = p.startsWith('/') ? p : join(f.includes('/hooks/') ? f.split('/hooks/')[0] : '', p);
            out.push({ path: abs.replace(/^\.\//, ''), kind: 'hook-script', from: f });
          }
        }
  }
  // 하네스가 엔진에 주입하는 훅 스크립트·템플릿 (scripts/hooks/*, 소스 안에서 이름으로 가리키는 .mjs)
  for (const f of tracked.filter((x) => x.startsWith('scripts/hooks/') && !x.includes('.test.')))
    out.push({ path: f, kind: 'injected-hook' });
  for (const f of tracked.filter(isSrc)) {
    const t = read(f);
    for (const m of t.matchAll(/['"`]((?:scripts|packages)\/[A-Za-z0-9_./-]+\.(?:mjs|js|sh))['"`]/g))
      if (tracked.includes(m[1])) out.push({ path: m[1], kind: 'referenced-script', from: f });
    if (/SANDBOX_HOOKS_SOURCE|hooks\.json|stop-bridge/.test(t))
      out.push({ path: f, kind: 'hook-template-source' });
  }
  save('dyn-hooks', out);
} else if (mode === 'mcp') {
  const tools = readJson(join(auditDir, 'snapshots', 'mcp-tools.json'), []);
  const out = tools.map((t) => ({ path: t.file, kind: 'mcp-tool', name: t.name }));
  for (const f of tracked.filter(isSrc))
    if (/registerTool\(|McpServer|StdioServerTransport/.test(read(f)))
      out.push({ path: f, kind: 'mcp-server' });
  for (const f of tracked.filter((x) => /mcp-host\/src\/bin\.ts$/.test(x)))
    out.push({ path: f, kind: 'mcp-bin' });
  save('dyn-mcp', out);
} else if (mode === 'cli') {
  const out = [{ path: 'packages/kernel/src/cli.ts', kind: 'cli-main' }];
  const cli = read('packages/kernel/src/cli.ts');
  // cli.ts가 동적으로 불러오는 모듈 (await import('./x.js'))
  for (const m of cli.matchAll(/import\(\s*['"](\.\/[^'"]+)['"]\s*\)/g))
    out.push({ path: join('packages/kernel/src', m[1]).replace(/\.js$/, '.ts'), kind: 'cli-lazy-import' });
  for (const m of cli.matchAll(
    /from\s+['"](\.\/[^'"]*(?:cli|resume|approvals|install|reindex|run)[^'"]*)['"]/g,
  ))
    out.push({ path: join('packages/kernel/src', m[1]).replace(/\.js$/, '.ts'), kind: 'cli-command' });
  // 다른 패키지의 bin
  for (const f of tracked.filter((x) => x.endsWith('package.json') && !x.includes('node_modules'))) {
    const j = JSON.parse(read(f));
    const bins = typeof j.bin === 'string' ? [j.bin] : Object.values(j.bin ?? {});
    for (const b of bins)
      out.push({
        path: join(
          f,
          '..',
          String(b)
            .replace(/^\.\/dist\//, 'src/')
            .replace(/\.js$/, '.ts'),
        ),
        kind: 'package-bin',
        pkg: j.name,
      });
  }
  save(
    'dyn-cli',
    out.filter((o) => existsSync(join(root, o.path))),
  );
} else if (mode === 'registries') {
  const out = [];
  for (const f of srcOf('packages/sdk/templates/')) out.push({ path: f, kind: 'sdk-template' });
  for (const f of tracked.filter((x) => x.endsWith('SKILL.md'))) out.push({ path: f, kind: 'skill' });
  for (const f of tracked.filter((x) => /harness-plugin\.json$/.test(x)))
    out.push({ path: f, kind: 'plugin-manifest' });
  const regRe =
    /(comparators|verifiers|installer\/src\/adapters|engines\/[^/]+\/src\/(adapter|engine)|agent-builder\/src\/(templates|registry)|run-mode|settings\/registry|actions\/registry)/;
  for (const f of tracked.filter((x) => isSrc(x) && regRe.test(x)))
    out.push({ path: f, kind: 'name-registry' });
  // examples/ (예시 에이전트·플러그인), assets/
  for (const f of tracked.filter((x) => x.startsWith('examples/'))) out.push({ path: f, kind: 'example' });
  for (const f of tracked.filter((x) => /(^|\/)templates\//.test(x) && !x.startsWith('packages/sdk/')))
    out.push({ path: f, kind: 'template' });
  save('dyn-registries', out);
} else if (mode === 'fixtures') {
  const out = [];
  for (const f of tracked) {
    if (/(^|\/)(fixtures|__fixtures__|recordings?|__snapshots__)\//.test(f))
      out.push({ path: f, kind: /__snapshots__/.test(f) ? 'snapshot' : 'fixture' });
    else if (/\.(jsonl|rec\.json|ndjson)$/.test(f)) out.push({ path: f, kind: 'recording' });
  }
  save('dyn-fixtures', out);
} else if (mode === 'merge') {
  const names = ['dyn-plugins', 'dyn-hooks', 'dyn-mcp', 'dyn-cli', 'dyn-registries', 'dyn-fixtures'];
  const all = [];
  for (const n of names)
    for (const x of readJson(join(rawDir, `${n}.json`), [])) all.push({ ...x, source: n });
  const byPath = new Map();
  for (const x of all) {
    if (!byPath.has(x.path)) byPath.set(x.path, { path: x.path, kinds: [], sources: [] });
    const e = byPath.get(x.path);
    if (!e.kinds.includes(x.kind)) e.kinds.push(x.kind);
    if (!e.sources.includes(x.source)) e.sources.push(x.source);
  }
  const entries = [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
  // 빌드해야 생기는 경로(dist/…)와 템플릿 자리표시자는 원본이 있으면 인정
  const missing = entries.filter(
    (e) =>
      !existsSync(join(root, e.path)) && !(e.path.includes('/dist/') && e.path.includes('sdk/templates')),
  );
  writeJson(join(auditDir, 'dynamic-entries.json'), {
    generatedAt: new Date().toISOString(),
    count: entries.length,
    missing: missing.map((m) => m.path),
    entries,
  });
  console.log(`dynamic-entries: ${entries.length}개, 실제 없음 ${missing.length}개`);
  if (missing.length) console.log(missing.map((m) => m.path).join('\n'));
} else {
  console.error('usage: collect-dynamic.mjs <hooks|mcp|cli|registries|fixtures|merge>');
  process.exit(1);
}
