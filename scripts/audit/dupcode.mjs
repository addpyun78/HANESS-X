// C5.1 복사 코드 검사 — 로컬 대체판(jscpd를 pnpm dlx로 받는 것은 자동 모드가 외부 코드로 막음)
// TypeScript 스캐너로 토큰을 만들고(식별자·문자열 값은 그대로) 연속 50토큰 창의 해시가 같은 곳을 찾아 이어 붙인다.
// 대상: packages·apps의 src(테스트·dist 제외). → raw/jscpd/jscpd-report.json (statistics + duplicates 상위)
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { rawDir, readFileSync, root, sh, writeJson } from './lib.mjs';
const require = createRequire(join(root, 'package.json'));
const ts = require('typescript');
const MIN = Number(process.argv[2] ?? 50);
const files = sh('git ls-files packages apps')
  .split('\n')
  .filter((f) => /\/src\/.*\.(ts|tsx)$/.test(f) && !/\.test\.|\.d\.ts$|\/dist\//.test(f));
const toks = new Map();
let totalTokens = 0;
let totalLines = 0;
for (const f of files) {
  const text = readFileSync(join(root, f), 'utf8');
  totalLines += text.split('\n').length;
  const sc = ts.createScanner(
    ts.ScriptTarget.Latest,
    true,
    f.endsWith('x') ? ts.LanguageVariant.JSX : ts.LanguageVariant.Standard,
    text,
  );
  const list = [];
  for (let k = sc.scan(); k !== ts.SyntaxKind.EndOfFileToken; k = sc.scan()) {
    // import 줄은 중복으로 세지 않는다
    list.push({ t: `${k}:${sc.getTokenText()}`, line: text.slice(0, sc.getTokenPos()).split('\n').length });
  }
  const filtered = [];
  for (let i = 0; i < list.length; i++) {
    if (list[i].t === `${ts.SyntaxKind.ImportKeyword}:import`) {
      while (i < list.length && !list[i].t.startsWith(`${ts.SyntaxKind.SemicolonToken}:`)) i++;
      continue;
    }
    filtered.push(list[i]);
  }
  toks.set(f, filtered);
  totalTokens += filtered.length;
}
const h = (arr, i) =>
  createHash('sha1')
    .update(
      arr
        .slice(i, i + MIN)
        .map((x) => x.t)
        .join('\u0001'),
    )
    .digest('hex');
const first = new Map();
const pairs = new Map(); // key fileA|fileB|startA → clone
for (const [f, arr] of toks) {
  for (let i = 0; i + MIN <= arr.length; i++) {
    const k = h(arr, i);
    const prev = first.get(k);
    if (!prev) {
      first.set(k, { f, i });
      continue;
    }
    if (prev.f === f && Math.abs(prev.i - i) < MIN) continue;
    // 이어지는 창이면 기존 클론을 늘린다
    const key = `${prev.f}|${f}`;
    const list = pairs.get(key) ?? [];
    const last = list.at(-1);
    if (last && last.aEnd === prev.i + MIN - 1 && last.bEnd === i + MIN - 1) {
      last.aEnd++;
      last.bEnd++;
    } else list.push({ aStart: prev.i, aEnd: prev.i + MIN, bStart: i, bEnd: i + MIN });
    pairs.set(key, list);
  }
}
const dups = [];
for (const [key, list] of pairs) {
  const [a, b] = key.split('|');
  const A = toks.get(a);
  const B = toks.get(b);
  for (const c of list) {
    const tokens = c.aEnd - c.aStart;
    dups.push({
      tokens,
      lines: A[Math.min(c.aEnd, A.length - 1)].line - A[c.aStart].line + 1,
      firstFile: { name: a, start: A[c.aStart].line, end: A[Math.min(c.aEnd, A.length - 1)].line },
      secondFile: { name: b, start: B[c.bStart].line, end: B[Math.min(c.bEnd, B.length - 1)].line },
    });
  }
}
dups.sort((x, y) => y.tokens - x.tokens);
const dupTokens = dups.reduce((s, d) => s + d.tokens, 0);
const dupLines = dups.reduce((s, d) => s + d.lines, 0);
mkdirSync(join(rawDir, 'jscpd'), { recursive: true });
const statistics = {
  total: {
    sources: files.length,
    lines: totalLines,
    tokens: totalTokens,
    clones: dups.length,
    duplicatedLines: dupLines,
    duplicatedTokens: dupTokens,
    percentage: +((dupLines / totalLines) * 100).toFixed(2),
    percentageTokens: +((dupTokens / totalTokens) * 100).toFixed(2),
  },
};
writeJson(join(rawDir, 'jscpd', 'jscpd-report.json'), {
  tool: 'scripts/audit/dupcode.mjs (jscpd 대체)',
  minTokens: MIN,
  statistics,
  top20: dups.slice(0, 20),
  duplicates: dups.slice(0, 300),
});
console.log(
  `dupcode: 파일 ${files.length}, 복사 묶음 ${dups.length}, 중복 줄 ${dupLines}/${totalLines} (${statistics.total.percentage}%)`,
);
for (const d of dups.slice(0, 20))
  console.log(
    `  ${d.tokens}tok ${d.firstFile.name}:${d.firstFile.start}-${d.firstFile.end} = ${d.secondFile.name}:${d.secondFile.start}-${d.secondFile.end}`,
  );
