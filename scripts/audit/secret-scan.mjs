// C1.21 저장소 비밀 검사(로컬 대체판): Git이 추적하는 파일 전체를 하네스 비밀 패턴 + 흔한 비밀 형식으로 검사
//   (pnpm dlx @secretlint/quick-start 실행은 자동 모드가 외부 패키지 실행으로 막아 이 스크립트로 대신함)
// C1.22 로그·픽스처·녹화 폴더를 하네스 마스킹 패턴으로 검사
// usage: node scripts/audit/secret-scan.mjs repo   → raw/secretlint.txt
//        node scripts/audit/secret-scan.mjs data   → raw/secret-data.json
// 결과에는 비밀 원문을 남기지 않는다(앞 4자 + 길이만)
import { join } from 'node:path';
import { homedir } from 'node:os';
import { readdirSync, statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { existsSync, rawDir, readFileSync, root, sh, writeFileSync, writeJson } from './lib.mjs';
const { SECRET_PATTERNS } = await import(
  pathToFileURL(join(root, 'packages', 'kernel', 'dist', 'secrets-mask.js')).href
);
const EXTRA = [
  { name: 'private-key', re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g },
  { name: 'npm-token', re: /\bnpm_[A-Za-z0-9]{36}\b/g },
  { name: 'jwt', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
  { name: 'basic-auth-url', re: /\b[a-z]+:\/\/[^\s:/@'"]+:[^\s:/@'"]{6,}@[^\s'"]+/g },
  {
    name: 'generic-assign',
    re: /\b(?:api[_-]?key|secret|password|passwd|token)\s*[:=]\s*['"][A-Za-z0-9_\-+/=]{20,}['"]/gi,
  },
];
const PATS = [...SECRET_PATTERNS, ...EXTRA];
// 테스트가 일부러 넣은 가짜 값(가짜·fake·dummy·test·example·xxx 등)은 '테스트 값'으로 따로 표시
const FAKE = /(fake|dummy|test|example|sample|xxxx|0000|1234|abcd|aaaa|redacted|placeholder|가짜)/i;
function scanText(t, file, out) {
  const lines = t.split('\n');
  for (const { name, re } of PATS) {
    re.lastIndex = 0;
    for (const m of t.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'))) {
      const line = t.slice(0, m.index).split('\n').length;
      const ctx = lines[line - 1] ?? '';
      out.push({
        file,
        line,
        rule: name,
        preview: `${m[0].slice(0, 4)}…(${m[0].length}자)`,
        likelyTestValue: FAKE.test(m[0]) || FAKE.test(ctx) || /\.test\.|fixtures|__snapshots__/.test(file),
      });
    }
  }
}
const mode = process.argv[2];
if (mode === 'repo') {
  const files = sh('git ls-files')
    .split('\n')
    .filter(
      (f) =>
        f &&
        !f.startsWith('docs/audit/raw/') &&
        !/\.(png|jpg|jpeg|gif|ico|woff2?|ttf|pdf|zip|gz|sqlite|wasm)$/i.test(f),
    );
  const out = [];
  for (const f of files) {
    let t;
    try {
      t = readFileSync(join(root, f), 'utf8');
    } catch {
      continue;
    }
    scanText(t, f, out);
  }
  const real = out.filter((o) => !o.likelyTestValue);
  const txt = [
    `# 저장소 비밀 검사 (로컬 대체판, ${new Date().toISOString()})`,
    `# 대상: git이 추적하는 파일 ${files.length}개 (docs/audit/raw 제외), 규칙 ${PATS.length}개(하네스 SECRET_PATTERNS + 개인 키·npm·JWT·주소 속 비밀번호·키 대입)`,
    `# 원래 명령 pnpm dlx @secretlint/quick-start 는 자동 모드가 외부 패키지 실행으로 막아 대신함`,
    `# 발견 ${out.length}건 (테스트용 가짜 값으로 보이는 것 ${out.length - real.length}건, 진짜 의심 ${real.length}건)`,
    ...out.map(
      (o) => `${o.likelyTestValue ? '[테스트값]' : '[의심]'} ${o.file}:${o.line} ${o.rule} ${o.preview}`,
    ),
  ].join('\n');
  writeFileSync(join(rawDir, 'secretlint.txt'), txt + '\n');
  console.log(`repo: 파일 ${files.length}개, 발견 ${out.length}건, 진짜 의심 ${real.length}건`);
} else if (mode === 'data') {
  const home = process.env.HARNESS_X_HOME ?? join(homedir(), '.harness-x');
  const targets = [
    join(home, 'logs'),
    join(home, 'sessions'),
    join(root, 'fixtures'),
    join(root, 'e2e', 'fixtures'),
    ...sh('git ls-files')
      .split('\n')
      .filter((f) => /\/fixtures\/|\.jsonl$/.test(f))
      .map((f) => join(root, f)),
  ];
  const files = new Set();
  const walk = (p) => {
    if (!existsSync(p)) return;
    const s = statSync(p);
    if (s.isFile())
      return void (
        s.size < 20 * 1024 * 1024 &&
        !/\.(sqlite|sqlite-wal|sqlite-shm|png|jpg|zip|pdf)$/.test(p) &&
        files.add(p)
      );
    for (const n of readdirSync(p)) walk(join(p, n));
  };
  targets.forEach(walk);
  const out = [];
  for (const f of files)
    scanText(readFileSync(f, 'utf8'), f.replace(homedir(), '~').replace(root + '/', ''), out);
  const real = out.filter((o) => !o.likelyTestValue);
  writeJson(join(rawDir, 'secret-data.json'), {
    files: files.size,
    hits: out.length,
    suspicious: real.length,
    items: out,
  });
  console.log(`data: 파일 ${files.size}개, 발견 ${out.length}건, 진짜 의심 ${real.length}건`);
}
