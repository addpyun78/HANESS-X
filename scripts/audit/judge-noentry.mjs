// C2.18 진입점 없는 기능(feature-map.noEntry)마다 실제 동작 확인·판정
//  ① 대표 테스트(@features 태그·연결 테스트)가 1회차 전체 실행에서 통과했는가 (= 지금 실제로 동작)
//  ② 기능 코드 파일을 다른 실행 코드(src)가 불러 쓰는가 (= 화면·API 없이 다른 기능 안에서 쓰이는 부품)
//  둘 다면 '정상(내부 부품)', ①만이면 '확인 필요(쓰는 곳 없음)', ①이 없으면 '확인 필요(동작 확인 못 함)'
import { join, basename } from 'node:path';
import { auditDir, rawDir, readJson, readFileSync, rel, root, sh, writeJson } from './lib.mjs';
import { taggedFiles } from './feature-tags.mjs';
const map = readJson(join(auditDir, 'feature-map.json'));
const run1 = readJson(join(rawDir, 'test-run-1.json'));
const passed = new Set(run1.testResults.filter((f) => f.status === 'passed').map((f) => rel(f.name)));
const tagged = taggedFiles();
const src = sh('git ls-files')
  .split('\n')
  .filter((f) => /\/src\/.*\.(ts|tsx)$/.test(f) && !/\.test\./.test(f));
const text = new Map();
const t = (f) =>
  text.has(f) ? text.get(f) : (text.set(f, readFileSync(join(root, f), 'utf8')), text.get(f));
const out = [];
for (const id of map.noEntry ?? []) {
  const f = map.features.find((x) => x.id === id);
  const reps = [...tagged].filter(([, ids]) => ids.includes(id)).map(([p]) => p);
  const tests = [...new Set([...reps, ...f.tests])];
  const passing = tests.filter((x) => passed.has(x));
  let codeFiles = [...new Set(f.code.map((c) => c.at.split(':')[0]))].filter((x) => /\/src\//.test(x));
  // 문서가 코드 파일을 직접 말하지 않은 기능: 통과한 테스트가 불러오는 src 파일을 기능 코드로 본다
  if (!codeFiles.length)
    for (const tf of passing)
      for (const m of t(tf).matchAll(/from ['"](\.{1,2}\/[^'"]*src\/[^'"]+)['"]/g)) {
        const p = rel(join(root, tf, '..', m[1])).replace(/\.js$/, '');
        for (const ext of ['.ts', '.tsx']) if (src.includes(p + ext)) codeFiles.push(p + ext);
      }
  codeFiles = [...new Set(codeFiles)];
  const users = new Set();
  for (const cf of codeFiles) {
    const stem = basename(cf).replace(/\.(tsx?|mjs)$/, '');
    if (stem === 'index') continue;
    const re = new RegExp(`from ['"][^'"]*/${stem}(\\.js|\\.tsx?)?['"]`);
    for (const s of src) if (s !== cf && re.test(t(s))) users.add(s);
    // 패키지 이름으로 쓰는 경우(@harness-x/<pkg>) — 그 패키지 index가 내보내면 사용됨으로 본다
    const pkg = cf.match(
      /^(packages\/(?:plugins-core\/verifiers\/[^/]+|plugins-core\/[^/]+|plugins\/[^/]+|engines\/[^/]+|[^/]+))\/src\//,
    )?.[1];
    if (pkg) {
      const name = readJson(join(root, pkg, 'package.json'), {}).name;
      if (name) for (const s of src) if (!s.startsWith(pkg + '/') && t(s).includes(`'${name}'`)) users.add(s);
    }
  }
  const verdict =
    passing.length && users.size
      ? '정상(내부 부품)'
      : passing.length
        ? '확인 필요(쓰는 곳 없음)'
        : codeFiles.length
          ? '확인 필요(동작 확인 못 함)'
          : '정상(문서·설정 기능)';
  out.push({
    id,
    name: f.name,
    verdict,
    passingTests: passing.length,
    tests: tests.length,
    codeFiles: codeFiles.length,
    users: users.size,
    usersSample: [...users].slice(0, 3),
    repTests: reps.slice(0, 2),
  });
}
writeJson(join(rawDir, 'noentry-judge.json'), out);
const c = {};
for (const o of out) c[o.verdict] = (c[o.verdict] ?? 0) + 1;
console.log(JSON.stringify(c));
for (const o of out.filter((o) => !o.verdict.startsWith('정상')))
  console.log(
    o.id,
    o.name,
    o.verdict,
    `tests ${o.passingTests}/${o.tests} code ${o.codeFiles} users ${o.users}`,
  );
