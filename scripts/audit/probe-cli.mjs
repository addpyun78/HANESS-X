// C2.6 CLI 명령마다 --help와 안전한 최소 실행(쓰기 없는 옵션) → 미구현 메시지·--help 무시 → raw/shell-cli.json
// 임시 홈에서만 실행(사용자 ~/.harness-x·켜진 서버에 닿지 않음)
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rawDir, root, run, writeJson } from './lib.mjs';
const cli = join(root, 'packages', 'kernel', 'dist', 'cli.js');
const home = mkdtempSync(join(tmpdir(), 'hx-cli-probe-'));
const env = {
  ...process.env,
  HOME: home,
  USERPROFILE: home,
  HARNESS_X_HOME: join(home, '.harness-x'),
  HARNESS_X_TOKEN: '',
};
const x = (args) => {
  const r = run(process.execPath, ['--no-warnings', cli, ...args], { env, cwd: home, timeout: 120_000 });
  const outText = `${r.stdout ?? ''}\n${r.stderr ?? ''}`.trim();
  return {
    args: args.join(' '),
    exit: r.status,
    firstLine: outText.split('\n')[0]?.slice(0, 160) ?? '',
    notImplemented: /not implemented|미구현|준비 중/i.test(outText),
    wroteFiles: false,
  };
};
const cases = [
  ['--help'],
  ['serve', '--help'],
  ['approvals', '--help'],
  ['install', '--help'],
  ['tools', '--help'],
  ['tools', 'list'],
  ['tools', 'allow', '--help'],
  ['run', '--help'],
  ['reindex', '--help'],
  ['resume', '--help'],
  ['resume'],
  ['approvals'],
];
const out = [];
for (const c of cases) {
  const before = run('find', [home, '-type', 'f'], { encoding: 'utf8' })
    .stdout.split('\n')
    .filter(Boolean).length;
  const r = x(c);
  const after = run('find', [home, '-type', 'f'], { encoding: 'utf8' })
    .stdout.split('\n')
    .filter(Boolean).length;
  r.wroteFiles = after > before;
  // --help를 줬는데 도움말이 아닌 실제 실행을 한 경우
  r.helpIgnored =
    c.includes('--help') && !/사용법|usage|^harness-x [a-z<]|엔진 중립 에이전트 하네스/i.test(r.firstLine);
  out.push(r);
}
rmSync(home, { recursive: true, force: true });
writeJson(join(rawDir, 'shell-cli.json'), out);
console.log(
  `probe-cli: ${out.length}개 실행, 미구현 ${out.filter((o) => o.notImplemented).length}, --help 무시 ${out.filter((o) => o.helpIgnored).length}, 파일 쓴 실행 ${out.filter((o) => o.wroteFiles).length}`,
);
for (const o of out)
  console.log(
    `  [${o.exit}] ${o.args}${o.helpIgnored ? ' ⚠--help 무시' : ''}${o.wroteFiles ? ' ✎파일 씀' : ''} → ${o.firstLine.slice(0, 90)}`,
  );
