// B.5~B.14 기능 지도 연결: 기능 ↔ 진입점(화면 동작·API·CLI·MCP·훅·설정) ↔ 코드(파일:줄) ↔ 테스트
// usage: node scripts/audit/link-features.mjs <단계> (actions|api|cli|mcp|hooks|settings|noentry|code|tests|notest|all)
// 연결 근거(정적·결정적):
//  1) 기능의 완료 항목 문장·결과 줄에 진입점 이름(id·경로·키·명령)이 그대로 나오면 연결
//  2) 기능 문서가 언급한 소스 파일 안에 진입점이 정의(API·MCP·훅)되거나 쓰이면(act('id')·설정 키 문자열) 연결
import { join, basename } from 'node:path';
import { taggedFiles } from './feature-tags.mjs';
import { auditDir, listFiles, readFileSync, readJson, rel, root, rawDir, writeJson } from './lib.mjs';

const step = process.argv[2] ?? 'all';
const mapFile = join(auditDir, 'feature-map.json');
const map = readJson(mapFile);
const snap = (n) => readJson(join(auditDir, 'snapshots', `${n}.json`));
const done = readJson(join(rawDir, 'done-items.json'), []);

// 기능별 문서 텍스트(항목 문장 + 결과 줄)
const textOf = new Map();
for (const f of map.features) {
  if (f.extra) {
    textOf.set(f.id, `${f.name} ${(f.keywords ?? []).join(' ')}`);
    continue;
  }
  const ids = new Set(f.items ?? []);
  const src = f.sources[0];
  const its = done.filter(
    (d) => d.ticket === src.ticket && (/^T-10\d$/.test(d.ticket) ? d.section === src.section : true),
  );
  textOf.set(f.id, `${f.name}\n` + its.map((d) => `${d.text} ${d.result ?? ''}`).join('\n'));
  void ids;
}

const allSrc = listFiles(
  root,
  (p) =>
    /\.(ts|tsx|mjs)$/.test(p) &&
    !p.endsWith('.d.ts') &&
    /[\\/](src|scripts)[\\/]/.test(p) &&
    !/\.test\.tsx?$/.test(p),
  { skipDirs: ['node_modules', 'dist', '.git', '.claude', 'target', '.harness-x-dev', 'docs', 'audit'] },
).map(rel);
const allTests = listFiles(root, (p) => /\.test\.tsx?$/.test(p), {
  skipDirs: ['node_modules', 'dist', '.git', '.claude', 'target', '.harness-x-dev'],
}).map(rel);
const byBase = new Map();
for (const f of [...allSrc, ...allTests]) {
  const b = basename(f);
  if (!byBase.has(b)) byBase.set(b, []);
  byBase.get(b).push(f);
}
const srcText = new Map();
const read = (f) => {
  if (!srcText.has(f)) srcText.set(f, readFileSync(join(root, f), 'utf8'));
  return srcText.get(f);
};

/** 문서 텍스트가 언급한 파일(경로 또는 파일 이름) */
function mentionedFiles(text, pool) {
  const out = new Set();
  for (const m of text.matchAll(/([A-Za-z0-9_./-]+\.(?:test\.)?(?:tsx?|mjs))/g)) {
    const s = m[1].replace(/^\.\//, '');
    const hits = s.includes('/')
      ? pool.filter((p) => p.endsWith(s))
      : (byBase.get(s) ?? []).filter((p) => pool.includes(p));
    if (hits.length && hits.length <= 3) hits.forEach((h) => out.add(h));
  }
  return [...out];
}
const filesOf = (f) => mentionedFiles(textOf.get(f.id), allSrc);
const has = (text, needle) => needle.length >= 4 && text.includes(needle);

const stats = {};
function linkActions() {
  const ids = snap('actions').map((a) => a.id);
  const usedIn = new Map(ids.map((id) => [id, []]));
  const webFiles = allSrc.filter((f) => f.startsWith('apps/web/src/'));
  for (const f of webFiles)
    for (const m of read(f).matchAll(/(?:(?:act|actionAttr)\(\s*['`]|data-action=")([^'`"<]+)['`"]/g))
      usedIn.get(m[1])?.push(f);
  let n = 0;
  for (const f of map.features) {
    const t = textOf.get(f.id);
    const files = new Set(filesOf(f));
    f.entries.actions = ids.filter((id) => has(t, id) || usedIn.get(id).some((x) => files.has(x)));
    n += f.entries.actions.length;
  }
  stats.actions = n;
}
function linkApi() {
  const routes = snap('api-routes');
  let n = 0;
  for (const f of map.features) {
    const t = textOf.get(f.id);
    const files = new Set(filesOf(f));
    const generic = (p) => p.replace(/:[a-zA-Z]+/g, '');
    f.entries.api = [
      ...new Set(
        routes
          .filter(
            (r) =>
              files.has(r.file) ||
              (r.path.length > 6 &&
                (t.includes(r.path) || t.includes(generic(r.path).replace(/\/$/, '') + '/'))),
          )
          .map((r) => `${r.method} ${r.path}`),
      ),
    ];
    n += f.entries.api.length;
  }
  stats.api = n;
}
function linkCli() {
  const cli = snap('cli');
  let n = 0;
  for (const f of map.features) {
    const t = textOf.get(f.id);
    f.entries.cli = cli.commands.filter(
      (c) => t.includes(`harness-x ${c.split(' ')[0]}`) || t.includes(`harness-x ${c}`),
    );
    n += f.entries.cli.length;
  }
  stats.cli = n;
}
function linkMcp() {
  const tools = snap('mcp-tools');
  let n = 0;
  for (const f of map.features) {
    const t = textOf.get(f.id);
    const files = new Set(filesOf(f));
    f.entries.mcp = [
      ...new Set(tools.filter((x) => t.includes(x.name) || files.has(x.file)).map((x) => x.name)),
    ];
    n += f.entries.mcp.length;
  }
  stats.mcp = n;
}
function linkHooks() {
  const h = snap('hooks');
  let n = 0;
  for (const f of map.features) {
    const t = textOf.get(f.id);
    const files = new Set(filesOf(f));
    const reg = h.registrations.filter((r) => files.has(r.file)).map((r) => `${r.hook}@${r.file}`);
    const names = h.hookNames.filter((x) => new RegExp(`\\b${x.replace('.', '\\.')}\\b`).test(t));
    const nat = h.native
      .filter((x) => files.has(x.source) || (x.command && t.includes(x.command)))
      .map((x) => `native:${x.event}@${x.source}`);
    f.entries.hooks = [...new Set([...names, ...reg, ...nat])];
    n += f.entries.hooks.length;
  }
  stats.hooks = n;
}
function linkSettings() {
  const keys = snap('settings-keys').map((k) => k.key);
  let n = 0;
  for (const f of map.features) {
    const t = textOf.get(f.id);
    const files = filesOf(f);
    f.entries.settings = keys.filter((k) => has(t, k) || files.some((x) => read(x).includes(`'${k}'`)));
    n += f.entries.settings.length;
  }
  stats.settings = n;
}
const entryCount = (f) => Object.values(f.entries).reduce((a, b) => a + b.length, 0);
function noEntry() {
  map.noEntry = map.features.filter((f) => entryCount(f) === 0).map((f) => f.id);
  stats.noEntry = map.noEntry.length;
}

// B.12 진입점마다 처리 함수의 파일:줄
function linkCode() {
  const routes = snap('api-routes');
  const tools = snap('mcp-tools');
  const h = snap('hooks');
  const actUse = new Map();
  const reg = read('apps/web/src/actions/registry.ts').split('\n');
  for (const f of allSrc.filter((x) => x.startsWith('apps/web/src/')))
    read(f)
      .split('\n')
      .forEach((l, i) => {
        for (const m of l.matchAll(/(?:(?:act|actionAttr)\(\s*['`]|data-action=")([^'`"<]+)['`"]/g))
          if (!actUse.has(m[1])) actUse.set(m[1], `${f}:${i + 1}`);
      });
  const cliSrc = read('packages/kernel/src/cli.ts').split('\n');
  const regLine = (id) => reg.findIndex((l) => l.includes(`'${id}'`)) + 1;
  const settingsSrc = read('packages/kernel/src/settings/registry.ts').split('\n');
  let unlinked = 0;
  for (const f of map.features) {
    const code = [];
    for (const a of f.entries.actions) {
      const loc = actUse.get(a) ?? (regLine(a) ? `apps/web/src/actions/registry.ts:${regLine(a)}` : null);
      if (loc) code.push({ entry: `action:${a}`, at: loc });
      else unlinked++;
    }
    for (const a of f.entries.api) {
      const [m, p] = a.split(' ');
      const r = routes.find((x) => x.method === m && x.path === p);
      if (r) code.push({ entry: `api:${a}`, at: `${r.file}:${r.line}` });
      else unlinked++;
    }
    for (const c of f.entries.cli) {
      const w = c.split(' ')[0];
      const i = cliSrc.findIndex((l) => l.includes(`'${w}'`));
      if (i >= 0) code.push({ entry: `cli:${c}`, at: `packages/kernel/src/cli.ts:${i + 1}` });
      else unlinked++;
    }
    for (const t of f.entries.mcp) {
      const x = tools.find((y) => y.name === t);
      if (x) code.push({ entry: `mcp:${t}`, at: `${x.file}:${x.line}` });
      else unlinked++;
    }
    for (const k of f.entries.hooks) {
      const [name, file] = k.split('@');
      if (file) {
        const r =
          h.registrations.find((x) => x.file === file && `${x.hook}` === name) ??
          h.native.find((x) => x.source === file);
        code.push({ entry: `hook:${k}`, at: `${file}:${r?.line ?? 1}` });
      } else {
        const i = read('packages/kernel/src/hooks.ts')
          .split('\n')
          .findIndex((l) => l.includes(`'${name}'`));
        code.push({ entry: `hook:${k}`, at: `packages/kernel/src/hooks.ts:${i + 1}` });
      }
    }
    for (const k of f.entries.settings) {
      const i = settingsSrc.findIndex((l) => l.includes(`'${k}'`));
      code.push({
        entry: `setting:${k}`,
        at: i >= 0 ? `packages/kernel/src/settings/registry.ts:${i + 1}` : 'plugin-config',
      });
    }
    // 진입점이 없어도 문서가 언급한 소스 파일은 코드로 연결
    for (const x of filesOf(f))
      if (!code.some((c) => c.at.startsWith(x + ':'))) code.push({ entry: 'doc', at: `${x}:1` });
    f.code = code;
  }
  stats.unlinkedEntries = unlinked;
}

// B.13 기능마다 테스트 파일
function linkTests() {
  let n = 0;
  const tagged = taggedFiles();
  const testText = new Map(allTests.map((t) => [t, null]));
  const tt = (t) => {
    if (testText.get(t) === null) {
      // 테스트가 불러오는 같은 폴더의 도우미 파일(*.helpers.ts 등) 내용도 한 단계 합친다
      let s = readFileSync(join(root, t), 'utf8');
      for (const m of s.matchAll(/from ['"](\.\/[^'"]+)['"]/g)) {
        const base = join(root, t, '..', m[1]).replace(/\.js$/, '');
        for (const ext of ['.ts', '.tsx']) {
          try {
            s += '\n' + readFileSync(base + ext, 'utf8');
            break;
          } catch {
            /* 없음 */
          }
        }
      }
      testText.set(t, s);
    }
    return testText.get(t);
  };
  for (const f of map.features) {
    const tests = new Set(mentionedFiles(textOf.get(f.id), allTests));
    // 코드 파일 이름(확장자 뺀 것)을 import하는 테스트
    const codeFiles = [...new Set(f.code.map((c) => c.at.split(':')[0]))].filter(
      (x) => !x.endsWith('registry.ts') && !x.endsWith('cli.ts'),
    );
    for (const cf of codeFiles) {
      const stem = basename(cf).replace(/\.(tsx?|mjs)$/, '');
      if (stem === 'index' || stem.length < 4) continue;
      for (const t of allTests)
        if (new RegExp(`from ['"][^'"]*/${stem}(\\.js|\\.tsx?)?['"]`).test(tt(t))) tests.add(t);
    }
    // 진입점 이름을 직접 부르는 테스트(API 경로·동작 id·MCP 도구·설정 키)
    const needles = [
      ...f.entries.api.map((a) => a.split(' ')[1]).filter((p) => !p.includes(':')),
      ...f.entries.actions,
      ...f.entries.mcp,
      ...f.entries.settings,
    ].filter((x) => x.length >= 6);
    if (needles.length)
      for (const t of allTests) if (needles.some((nd) => tt(t).includes(`'${nd}'`))) tests.add(t);
    // 기능 태그(// @features F-xxx)가 붙은 파일은 그 기능의 테스트
    for (const [file, ids] of tagged) if (ids.includes(f.id)) tests.add(file);
    f.tests = [...tests].sort();
    n += f.tests.length;
  }
  stats.testLinks = n;
}
function noTest() {
  map.noTest = map.features.filter((f) => f.tests.length === 0).map((f) => f.id);
  stats.noTest = map.noTest.length;
}

const steps = {
  actions: linkActions,
  api: linkApi,
  cli: linkCli,
  mcp: linkMcp,
  hooks: linkHooks,
  settings: linkSettings,
  noentry: noEntry,
  code: linkCode,
  tests: linkTests,
  notest: noTest,
};
if (step === 'all') Object.values(steps).forEach((s) => s());
else steps[step]();
map.linkStats = { ...(map.linkStats ?? {}), ...stats };
writeJson(mapFile, map);
console.log(JSON.stringify(stats));
