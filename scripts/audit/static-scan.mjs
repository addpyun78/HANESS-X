// C 단계 정적 검사 모음(읽기만). usage: node scripts/audit/static-scan.mjs <검사이름>
//  empty-catch(C1.10) · swallowed-catch(C1.11) · raw-paths(C1.19) · todo(C2.8) · not-implemented(C2.9)
//  prod-mocks(C2.10) · skipped-tests(C2.13) · assertless(C2.14) · trivial-assert(C2.15) · snapshot-only(C2.16)
//  boundary(C4.5) · shell-actions(C2.1)
// 결과: docs/audit/raw/<이름>.json
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { listFiles, rawDir, readFileSync, rel, root, writeJson } from './lib.mjs';

const require = createRequire(join(root, 'package.json'));
const ts = require('typescript');
const SKIP = ['node_modules', 'dist', '.git', '.claude', 'target', '.harness-x-dev', 'docs', 'gen'];
const isTest = (p) => /\.test\.tsx?$/.test(p) || /[\\/](test|tests|e2e|fixtures)[\\/]/.test(p);
const srcFiles = listFiles(
  root,
  (p) => /\.(ts|tsx)$/.test(p) && !p.endsWith('.d.ts') && /[\\/]src[\\/]/.test(p) && !isTest(p),
  { skipDirs: SKIP },
);
const testFiles = listFiles(root, (p) => /\.test\.tsx?$/.test(p), { skipDirs: SKIP });
const lineOf = (t, i) => t.slice(0, i).split('\n').length;
const parse = (f) =>
  ts.createSourceFile(
    f,
    readFileSync(f, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    f.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
const walk = (node, fn) => {
  fn(node);
  ts.forEachChild(node, (c) => walk(c, fn));
};

const checks = {
  'empty-catch'() {
    const out = [];
    for (const f of srcFiles) {
      const sf = parse(f);
      walk(sf, (n) => {
        if (ts.isCatchClause(n) && n.block.statements.length === 0) {
          const text = n.block.getFullText(sf);
          out.push({
            file: rel(f),
            line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1,
            commented: /\/[/*]/.test(text),
          });
        }
      });
    }
    return out;
  },
  'swallowed-catch'() {
    // catch 블록에 다시 던지기·로그·오류 반환·오류 변수 사용이 하나도 없는 곳 (주석 있는 빈 catch 포함)
    const out = [];
    for (const f of srcFiles) {
      const sf = parse(f);
      walk(sf, (n) => {
        if (!ts.isCatchClause(n)) return;
        let handled = false;
        const v = n.variableDeclaration?.name.getText(sf);
        walk(n.block, (x) => {
          if (ts.isThrowStatement(x) || ts.isReturnStatement(x)) handled = true;
          if (ts.isCallExpression(x)) {
            const c = x.expression.getText(sf);
            if (
              /(console\.|log\.|logger\.|\.warn|\.error|reject|emit|send|reply|push|set|record|report|fail)/i.test(
                c,
              )
            )
              handled = true;
          }
          if (v && ts.isIdentifier(x) && x.text === v && x.parent !== n.variableDeclaration) handled = true;
          if (ts.isBinaryExpression(x) && x.operatorToken.kind === ts.SyntaxKind.EqualsToken) handled = true;
        });
        if (!handled) {
          const body = n.block.getText(sf);
          out.push({
            file: rel(f),
            line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1,
            comment: (body.match(/\/[/*]\s*(.{0,80})/)?.[1] ?? '').trim(),
          });
        }
      });
    }
    return out;
  },
  'raw-paths'() {
    const out = [];
    const pats = [
      [/\.replace(All)?\(\s*\/\\\\\\\\\/g?\s*,\s*['`]\/['`]\)/g, '\\\\ → / 치환'],
      [/\.replace(All)?\(\s*['`]\\\\\\\\['`]\s*,/g, '\\\\ 치환'],
      [/\.split\(\s*['`]\/['`]\s*\)/g, "split('/')"],
      [/\.split\(\s*\/\[\\\\\\\\\/\]\/\s*\)/g, 'split(/[\\\\/]/)'],
      [/(?:dir|Dir|path|Path|root|Root|home|Home|cwd)\s*\+\s*['`]\//g, '문자열 더하기 경로'],
      [/`\$\{[a-zA-Z_.]*(?:dir|Dir|root|Root|home|Home|cwd)\}\/[^`]*`/g, '템플릿 문자열 경로'],
    ];
    for (const f of srcFiles) {
      if (/path-normalize|apps[\\/]web/.test(f)) continue; // 비교기 자체·브라우저(경로 아님)는 제외
      const t = readFileSync(f, 'utf8');
      for (const [re, kind] of pats)
        for (const m of t.matchAll(re))
          out.push({
            file: rel(f),
            line: lineOf(t, m.index),
            kind,
            code: t.split('\n')[lineOf(t, m.index) - 1].trim().slice(0, 120),
          });
    }
    return out;
  },
  todo() {
    const out = [];
    for (const f of srcFiles) {
      const t = readFileSync(f, 'utf8');
      for (const m of t.matchAll(/\b(TODO|FIXME|XXX|HACK)\b/g))
        out.push({
          file: rel(f),
          line: lineOf(t, m.index),
          tag: m[1],
          text: t.split('\n')[lineOf(t, m.index) - 1].trim().slice(0, 140),
        });
    }
    return out;
  },
  'not-implemented'() {
    const out = [];
    for (const f of srcFiles) {
      const t = readFileSync(f, 'utf8');
      for (const m of t.matchAll(/not[ _-]?implemented|미구현|준비 중|coming soon|NotImplemented/gi))
        out.push({
          file: rel(f),
          line: lineOf(t, m.index),
          text: t.split('\n')[lineOf(t, m.index) - 1].trim().slice(0, 140),
        });
    }
    return out;
  },
  'prod-mocks'() {
    const out = [];
    for (const f of srcFiles) {
      const t = readFileSync(f, 'utf8');
      for (const m of t.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*|require\(\s*)['"]([^'"\n]+)['"]/g))
        if (/(mock|fake|dummy|sample|fixtures?)/i.test(m[1]))
          out.push({ file: rel(f), line: lineOf(t, m.index), module: m[1] });
    }
    return out;
  },
  'skipped-tests'() {
    const out = [];
    for (const f of testFiles) {
      const t = readFileSync(f, 'utf8');
      for (const m of t.matchAll(/\b(it|test|describe)\.(skip|only|todo|skipIf|runIf)\b/g))
        out.push({
          file: rel(f),
          line: lineOf(t, m.index),
          kind: `${m[1]}.${m[2]}`,
          text: t.split('\n')[lineOf(t, m.index) - 1].trim().slice(0, 140),
        });
    }
    return out;
  },
  assertless() {
    // it/test 콜백 안에 expect·assert·toMatch·should·rejects 계열이 하나도 없는 테스트
    const out = [];
    for (const f of testFiles) {
      const sf = parse(f);
      walk(sf, (n) => {
        if (!ts.isCallExpression(n)) return;
        const callee = n.expression.getText(sf);
        if (!/^(it|test)(\.(concurrent|sequential|each\([^)]*\)))?$/.test(callee.replace(/\s/g, ''))) return;
        const fn = n.arguments.find((a) => ts.isArrowFunction(a) || ts.isFunctionExpression(a));
        if (!fn) return;
        const body = fn.getText(sf);
        if (
          /\b(expect|assert|expectTypeOf|assertType)\b|\.toThrow|\.rejects|\.resolves|check[A-Z]\w*\(|verify\w*\(|must\w*\(/.test(
            body,
          )
        )
          return;
        // 도우미 함수를 부르는 테스트(그 안에서 단언)는 '확인 필요'로 표시
        const helper = /\b[a-z]\w*(?:Case|Scenario|Run|Test|Check)\w*\(/.test(body);
        out.push({
          file: rel(f),
          line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1,
          name: n.arguments[0]?.getText(sf).slice(0, 100),
          viaHelper: helper,
        });
      });
    }
    return out;
  },
  'trivial-assert'() {
    const out = [];
    const re =
      /expect\(\s*(true|false|1|0|null|undefined|'[^']*'|"[^"]*"|\d+)\s*\)\s*\.(toBe|toEqual|toStrictEqual)\(\s*(true|false|1|0|null|undefined|'[^']*'|"[^"]*"|\d+)\s*\)/g;
    for (const f of testFiles) {
      const t = readFileSync(f, 'utf8');
      for (const m of t.matchAll(re))
        out.push({ file: rel(f), line: lineOf(t, m.index), code: m[0].slice(0, 120) });
      for (const m of t.matchAll(/expect\(\s*true\s*\)\.toBeTruthy\(\)/g))
        out.push({ file: rel(f), line: lineOf(t, m.index), code: m[0] });
    }
    return out;
  },
  'snapshot-only'() {
    const out = [];
    for (const f of testFiles.filter((x) => x.endsWith('.tsx') || /apps[\\/]web/.test(x))) {
      const t = readFileSync(f, 'utf8');
      if (!/toMatch(Inline)?Snapshot|toMatchFileSnapshot/.test(t)) continue;
      if (/fireEvent|userEvent|\.click\(|dispatchEvent|\.type\(|change\(|keyDown|act\(/.test(t)) continue;
      out.push({ file: rel(f), snapshots: (t.match(/toMatch(Inline|File)?Snapshot/g) ?? []).length });
    }
    return out;
  },
  boundary() {
    // 다른 패키지의 src/ 내부를 상대 경로로 import
    const out = [];
    const pkgOf = (p) =>
      rel(p).match(
        /^(packages\/(?:plugins-core\/verifiers\/[^/]+|plugins-core\/[^/]+|plugins\/[^/]+|engines\/[^/]+|[^/]+)|apps\/[^/]+)/,
      )?.[1];
    for (const f of [...srcFiles, ...testFiles]) {
      const t = readFileSync(f, 'utf8');
      const me = pkgOf(f);
      for (const m of t.matchAll(/from\s+['"](\.\.?\/[^'"]+)['"]/g)) {
        const target = join(f, '..', m[1]);
        const other = pkgOf(target);
        if (other && me && other !== me)
          out.push({ file: rel(f), line: lineOf(t, m.index), import: m[1], from: me, into: other });
      }
    }
    return out;
  },
  'shell-actions'() {
    // 등록된 전역 동작 처리 함수(registerActionHandler)와 onClick 처리 함수 중 본문이 비었거나 console.log/TODO만 있는 것
    const out = [];
    for (const f of srcFiles.filter((x) => /apps[\\/]web/.test(x))) {
      const sf = parse(f);
      walk(sf, (n) => {
        let fn;
        let label;
        if (
          ts.isJsxAttribute(n) &&
          /^on[A-Z]/.test(n.name.getText(sf)) &&
          n.initializer &&
          ts.isJsxExpression(n.initializer)
        ) {
          fn = n.initializer.expression;
          label = n.name.getText(sf);
        }
        if (ts.isCallExpression(n) && n.expression.getText(sf) === 'registerActionHandler') {
          fn = n.arguments[1];
          label = `registerActionHandler(${n.arguments[0]?.getText(sf)})`;
        }
        if (!fn || !(ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))) return;
        const body = fn.body;
        const stmts = ts.isBlock(body) ? body.statements : null;
        const raw = body.getText(sf);
        const empty = stmts && stmts.length === 0;
        const onlyLog =
          stmts && stmts.length > 0 && stmts.every((s) => /^console\.\w+\(/.test(s.getText(sf).trim()));
        const todo = /TODO|미구현|not implemented/i.test(raw) && raw.length < 200;
        const noop = !stmts && /^(undefined|null|void 0|\(\)\s*=>\s*\{\s*\})$/.test(raw.trim());
        if (empty || onlyLog || todo || noop)
          out.push({
            file: rel(f),
            line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1,
            handler: label,
            body: raw.slice(0, 100),
            why: empty ? '빈 본문' : onlyLog ? 'console만' : todo ? 'TODO' : '아무것도 안 함',
          });
      });
    }
    return out;
  },
};

const name = process.argv[2];
if (!checks[name]) {
  console.error(`검사 이름: ${Object.keys(checks).join(' | ')}`);
  process.exit(1);
}
const result = checks[name]();
writeJson(join(rawDir, `${name}.json`), result);
console.log(`${name}: ${result.length}건 → docs/audit/raw/${name}.json`);
