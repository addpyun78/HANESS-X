// C6.7 README의 명령 예시를 실제로 실행해 실패하는 것 → raw/readme-check.json
// 안전 규칙: 설치·빌드·전체 테스트·서버 실행 같은 오래 걸리거나 쓰는 명령은 '형식 확인'만(경로·하위 명령이 실제로 있는지),
//          읽기 명령(approvals 등)은 임시 홈에서 실제 실행
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync, rawDir, readFileSync, readJson, root, run, writeJson } from './lib.mjs';
const md = readFileSync(join(root, 'README.md'), 'utf8');
const blocks = [...md.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].map((m) => m[1]);
const cmds = blocks
  .flatMap((b) => b.split('\n'))
  .map((l) => l.replace(/#.*$/, '').trim())
  .filter((l) => /^(pnpm|node|npx|harness-x)\b/.test(l));
const pkg = readJson(join(root, 'package.json'));
const home = mkdtempSync(join(tmpdir(), 'hx-readme-'));
const ws = mkdtempSync(join(tmpdir(), 'hx-readme-ws-'));
const out = [];
for (const c of cmds) {
  const rec = { command: c };
  const parts = c.split('&&').map((s) => s.trim());
  const checks = [];
  for (const p of parts) {
    const [bin, ...args] = p.split(/\s+/);
    if (bin === 'pnpm') {
      const sub = args[0] === '-r' ? args[1] : args[0];
      const known =
        ['install', 'build', 'test', 'exec', 'dlx', 'add', 'remove'].includes(sub) || !!pkg.scripts?.[sub];
      checks.push({
        part: p,
        mode: '형식 확인(실행 안 함: 설치·빌드·전체 테스트는 오래 걸림)',
        ok: known,
        why: known ? `pnpm ${sub} 있음` : `package.json에 ${sub} 스크립트 없음`,
      });
    } else if (bin === 'node') {
      const file = args[0];
      const exists = existsSync(join(root, file));
      const sub = args[1];
      if (!exists) checks.push({ part: p, ok: false, why: `${file} 없음(빌드 필요?)` });
      else if (sub === 'serve')
        checks.push({
          part: p,
          mode: '형식 확인(서버는 계속 켜져 있어 실행 안 함)',
          ok: true,
          why: 'cli.js serve 있음',
        });
      else {
        const a = args
          .slice(1)
          .map((x) => (x === '<프로젝트 폴더>' ? ws : x))
          .filter((x) => !x.startsWith('<'));
        const r = run(process.execPath, ['--no-warnings', join(root, file), ...a], {
          env: { ...process.env, HOME: home, HARNESS_X_HOME: join(home, '.hx') },
          cwd: home,
          timeout: 120_000,
        });
        checks.push({
          part: p,
          mode: '실제 실행(임시 홈)',
          ok: r.status === 0,
          exit: r.status,
          firstLine: (r.stdout || r.stderr).trim().split('\n')[0]?.slice(0, 120),
        });
      }
    }
  }
  rec.checks = checks;
  rec.ok = checks.every((x) => x.ok);
  out.push(rec);
}
rmSync(home, { recursive: true, force: true });
rmSync(ws, { recursive: true, force: true });
writeJson(join(rawDir, 'readme-check.json'), out);
console.log(`readme-check: 명령 ${out.length}개, 실패 ${out.filter((o) => !o.ok).length}개`);
for (const o of out) console.log(`  ${o.ok ? 'ok ' : 'FAIL'} ${o.command}`);
