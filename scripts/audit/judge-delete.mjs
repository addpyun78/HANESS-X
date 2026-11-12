// C4.6 커버리지에서 한 번도 실행 안 된 파일 → raw/never-run-files.json
// C4.7 한 번도 실행 안 된 함수 → raw/never-run-functions.json
// C4.8 삭제 후보 4근거 판정 ① 정적 참조 없음(raw/knip.json) ② 동적 진입점 아님(dynamic-entries.json)
//      ③ 테스트에서 실행 안 됨(커버리지) ④ 기능 지도 미연결(feature-map.json) — 4개 모두면 '삭제 후보', 아니면 '확인 필요'
// usage: node scripts/audit/judge-delete.mjs <never-files|never-functions|judge> [--suffix .after] [--out delete-final]
import { join } from 'node:path';
import {
  auditDir,
  rawDir,
  readFileSync,
  readJson,
  rel,
  root,
  sh,
  writeFileSync,
  writeJson,
  existsSync,
  statSync,
} from './lib.mjs';
const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const suffix = arg('--suffix', '');
const covFile = join(rawDir, suffix ? 'coverage-final.after.json' : 'coverage-final.json');
const mode = process.argv[2];
const cov = () => {
  const c = readJson(covFile);
  if (!c) throw new Error(`${covFile} 없음 — A.10 커버리지를 먼저`);
  const out = new Map();
  for (const [abs, v] of Object.entries(c)) out.set(rel(abs), v);
  return out;
};
if (mode === 'never-files') {
  const c = cov();
  const list = [];
  for (const [f, v] of c) {
    const hits = Object.values(v.s ?? {});
    if (hits.length && hits.every((n) => n === 0)) list.push({ file: f, statements: hits.length });
  }
  writeJson(join(rawDir, `never-run-files${suffix}.json`), {
    coverageFiles: c.size,
    neverRun: list.length,
    files: list.sort((a, b) => a.file.localeCompare(b.file)),
  });
  console.log(`never-run-files: 커버리지 파일 ${c.size}개 중 한 번도 실행 안 됨 ${list.length}개`);
} else if (mode === 'never-functions') {
  const c = cov();
  const list = [];
  for (const [f, v] of c)
    for (const [id, fn] of Object.entries(v.fnMap ?? {}))
      if ((v.f?.[id] ?? 0) === 0)
        list.push({ file: f, name: fn.name, line: fn.loc?.start?.line ?? fn.decl?.start?.line });
  writeJson(join(rawDir, `never-run-functions${suffix}.json`), { neverRun: list.length, functions: list });
  console.log(`never-run-functions: 한 번도 실행 안 된 함수 ${list.length}개`);
} else if (mode === 'judge') {
  const knip = readJson(join(rawDir, `knip${suffix}.json`));
  const dyn = new Set(readJson(join(auditDir, 'dynamic-entries.json')).entries.map((e) => e.path));
  const nf = new Set(readJson(join(rawDir, `never-run-files${suffix}.json`)).files.map((x) => x.file));
  const nfn = readJson(join(rawDir, `never-run-functions${suffix}.json`)).functions;
  const c = cov();
  const map = readJson(join(auditDir, 'feature-map.json'));
  const featFiles = new Set(map.features.flatMap((f) => f.code.map((x) => x.at.split(':')[0])));
  // 패키지 입구(src/index.ts)가 다시 내보내는 파일 = 바깥(플러그인 작성자·다른 패키지)에 공개된 부품 → ② 동적/공개 진입점으로 본다
  const publicFiles = new Set();
  const reexp = (file, seen = new Set()) => {
    if (seen.has(file) || !existsSync(join(root, file))) return;
    seen.add(file);
    publicFiles.add(file);
    const t = readFileSync(join(root, file), 'utf8');
    for (const m of t.matchAll(/export\s+(?:\*|\{[^}]*\})\s+from\s+['"](\.[^'"]+)['"]/g)) {
      const base = join(file, '..', m[1]).split('\\').join('/').replace(/\.js$/, '');
      for (const ext of ['.ts', '.tsx', '/index.ts'])
        if (existsSync(join(root, base + ext))) reexp(base + ext, seen);
    }
  };
  for (const f of sh('git ls-files')
    .split('\n')
    .filter((x) => /^packages\/.*\/src\/index\.ts$/.test(x)))
    reexp(f);
  const out = [];
  const size = (f) => (existsSync(join(root, f)) ? statSync(join(root, f)).size : 0);
  for (const f of knip.files) {
    const e = {
      static: true,
      dynamic: !dyn.has(f),
      notRun: nf.has(f) || !c.has(f),
      noFeature: !featFiles.has(f),
    };
    out.push({
      kind: 'file',
      target: f,
      bytes: size(f),
      evidence: e,
      verdict: Object.values(e).every(Boolean) ? '삭제 후보' : '확인 필요',
    });
  }
  for (const x of knip.exports) {
    // 그 이름의 함수가 커버리지에서 0회거나(함수), 함수가 아닌 export(타입·상수)면 실행 근거 없음으로 본다
    const fnHit =
      c.get(x.file) && Object.entries(c.get(x.file).fnMap ?? {}).find(([, fn]) => fn.name === x.name);
    const notRun = fnHit
      ? (c.get(x.file).f?.[fnHit[0]] ?? 0) === 0
      : nfn.some((n) => n.file === x.file && n.name === x.name) || !fnHit;
    const e = {
      static: true,
      dynamic: !dyn.has(x.file) && !publicFiles.has(x.file),
      notRun,
      noFeature: !featFiles.has(x.file),
    };
    out.push({
      kind: 'export',
      target: `${x.file}#${x.name}`,
      evidence: e,
      verdict: Object.values(e).every(Boolean) ? '삭제 후보' : '확인 필요',
    });
  }
  for (const x of knip.dependencies) {
    const e = { static: true, dynamic: true, notRun: true, noFeature: true };
    out.push({
      kind: 'dependency',
      target: `${x.dir} → ${x.dependency}`,
      package: x.package,
      dir: x.dir,
      dependency: x.dependency,
      evidence: e,
      verdict: '삭제 후보',
    });
  }
  const name = arg('--out', 'delete-candidates');
  writeJson(join(rawDir, `${name}.json`), out);
  const cand = out.filter((o) => o.verdict === '삭제 후보');
  const row = (o) =>
    `| ${o.kind} | \`${o.target}\` | ${o.evidence.static ? '✓' : '✗'} | ${o.evidence.dynamic ? '✓' : '✗'} | ${o.evidence.notRun ? '✓' : '✗'} | ${o.evidence.noFeature ? '✓' : '✗'} | ${o.bytes ?? '—'} | ${o.verdict} |`;
  const md = `# 삭제 후보 (${name === 'delete-final' ? 'G.2 다시 판정' : 'C4.9'})\n\n4근거: ① 정적 참조 없음 ② 동적 진입점 아님 ③ 테스트에서 실행 안 됨 ④ 기능 지도 미연결. 넷 다 ✓면 "삭제 후보", 아니면 "확인 필요".\n\n- 전체 ${out.length}개 · 삭제 후보 ${cand.length}개 · 확인 필요 ${out.length - cand.length}개\n- 종류별 삭제 후보: 파일 ${cand.filter((o) => o.kind === 'file').length} · export ${cand.filter((o) => o.kind === 'export').length} · 의존성 ${cand.filter((o) => o.kind === 'dependency').length}\n\n## 삭제 후보\n\n| 종류 | 대상 | ① | ② | ③ | ④ | 크기(B) | 판정 |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n${cand.map(row).join('\n')}\n\n## 확인 필요 (상위 60)\n\n| 종류 | 대상 | ① | ② | ③ | ④ | 크기(B) | 판정 |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n${out
    .filter((o) => o.verdict !== '삭제 후보')
    .slice(0, 60)
    .map(row)
    .join('\n')}\n`;
  writeFileSync(join(auditDir, `${name}.md`), md);
  console.log(
    `judge: ${out.length}개 → 삭제 후보 ${cand.length}(파일 ${cand.filter((o) => o.kind === 'file').length}·export ${cand.filter((o) => o.kind === 'export').length}·의존성 ${cand.filter((o) => o.kind === 'dependency').length}), 확인 필요 ${out.length - cand.length}`,
  );
}
