// T-102 H.5~H.11 재발 방지 검사 (CI와 로컬에서 같은 명령: node scripts/ci/quality-gates.mjs [검사…])
//  unused     (H.5) 안 쓰는 파일·의존성 0 — dynamic-entries.json(이름으로 불러오는 파일)을 진입점에 포함
//  duplicate  (H.6) 복사 코드 비율 상한(점검 때 값 기준)
//  circular   (H.7) 실행되는 순환 의존 0 (import type 제외)
//  bundle     (H.8) 웹 번들 크기 상한(점검 때 값 + 10%) — apps/web/dist가 있어야 함(빌드 뒤)
//  dedupe     (H.9) 라이브러리 버전 중복 정리 상태(pnpm dedupe --check)
//  tests      (H.10) 단언 없는 테스트(도우미 없이)·.only·의미 없는 단언 금지
//  generated  (H.11) Git에 생성물(dist·coverage·로그·첨부·녹화 원본)이 올라오면 실패
// 상한 값은 scripts/ci/quality-limits.json (점검 결과로 정함, 줄이는 쪽으로만 고친다)
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const limits = JSON.parse(readFileSync(join(root, 'scripts', 'ci', 'quality-limits.json'), 'utf8'));
const node = (script, ...args) =>
  spawnSync(process.execPath, ['--no-warnings', join(root, script), ...args], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 1 << 28,
  });
const readRaw = (n) => JSON.parse(readFileSync(join(root, 'docs', 'audit', 'raw', n), 'utf8'));
const results = [];
const gate = (name, ok, detail) => results.push({ name, ok, detail });

const checks = {
  unused() {
    // 동적 진입점 목록을 지금 저장소 내용으로 다시 만든 뒤(H.12) 검사
    for (const m of ['hooks', 'mcp', 'cli', 'registries', 'fixtures'])
      node('scripts/audit/collect-dynamic.mjs', m);
    node('scripts/audit/manifests.mjs', 'dyn');
    node('scripts/audit/collect-dynamic.mjs', 'merge');
    node('scripts/audit/deadcode.mjs', '--out-suffix', '.ci');
    const k = readRaw('knip.ci.json');
    gate(
      'unused',
      k.files.length <= limits.unusedFiles && k.dependencies.length <= limits.unusedDependencies,
      `안 쓰는 파일 ${k.files.length}(상한 ${limits.unusedFiles}) · 의존성 ${k.dependencies.length}(상한 ${limits.unusedDependencies}) · export ${k.exports.length}(참고)`,
    );
  },
  duplicate() {
    node('scripts/audit/dupcode.mjs', '50');
    const r = readRaw('jscpd/jscpd-report.json').statistics.total;
    gate(
      'duplicate',
      r.percentage <= limits.duplicatePercent,
      `중복 줄 ${r.percentage}% (상한 ${limits.duplicatePercent}%)`,
    );
  },
  circular() {
    node('scripts/audit/deadcode.mjs', '--out-suffix', '.ci');
    const t = readFileSync(join(root, 'docs', 'audit', 'raw', 'madge-circular.ci.txt'), 'utf8');
    const n = Number(t.match(/순환 묶음 (\d+)개/)?.[1] ?? 0);
    gate('circular', n <= limits.circular, `실행되는 순환 묶음 ${n} (상한 ${limits.circular})`);
  },
  bundle() {
    const dist = join(root, 'apps', 'web', 'dist');
    if (!existsSync(dist)) return gate('bundle', false, 'apps/web/dist 없음 — 먼저 빌드');
    const r = node('scripts/audit/m-bundle.mjs');
    const bytes = JSON.parse(r.stdout.trim().split('\n').at(-1) ?? '{}').bytes ?? Infinity;
    gate(
      'bundle',
      bytes <= limits.bundleBytes,
      `웹 번들 ${bytes} B (상한 ${limits.bundleBytes} B = 점검 때 값 + 10%)`,
    );
  },
  dedupe() {
    const r = spawnSync('pnpm', ['dedupe', '--check'], { cwd: root, encoding: 'utf8' });
    gate(
      'dedupe',
      r.status === 0,
      r.status === 0
        ? '버전 중복 정리 상태 유지'
        : (r.stdout + r.stderr).trim().split('\n').slice(-3).join(' / '),
    );
  },
  tests() {
    for (const c of ['skipped-tests', 'assertless', 'trivial-assert'])
      node('scripts/audit/static-scan.mjs', c);
    const only = readRaw('skipped-tests.json').filter((x) => /\.only$/.test(x.kind));
    const assertless = readRaw('assertless.json').filter(
      (x) => !x.viaHelper && !limits.assertlessAllow.includes(`${x.file}:${x.line}`),
    );
    const trivial = readRaw('trivial-assert.json');
    gate(
      'tests',
      !only.length && !assertless.length && !trivial.length,
      `.only ${only.length} · 단언 없는 테스트 ${assertless.length} · 의미 없는 단언 ${trivial.length}`,
    );
  },
  generated() {
    const r = node('scripts/audit/size-scan.mjs', 'git-generated');
    const list = readRaw('git-generated.json');
    gate(
      'generated',
      list.length === 0,
      `Git이 추적하는 생성물 ${list.length}개${
        list.length
          ? ': ' +
            list
              .slice(0, 5)
              .map((x) => x.file)
              .join(', ')
          : ''
      }`,
    );
    void r;
  },
};

const want = process.argv.slice(2);
for (const name of want.length ? want : Object.keys(checks)) {
  if (!checks[name]) {
    console.error(`모르는 검사: ${name} (${Object.keys(checks).join(' | ')})`);
    process.exit(2);
  }
  checks[name]();
}
for (const r of results) console.log(`${r.ok ? '통과' : '실패'} ${r.name}: ${r.detail}`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
