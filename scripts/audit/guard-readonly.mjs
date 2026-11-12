// C.1 진단(C·D) 단계 가드: docs/audit/·scripts/audit/ 밖 변경이 있으면 실패(종료코드 1)
// 기준: 작업 트리 변경(커밋 안 된 것) + 기준 커밋(--since, 기본 C 시작 태그 audit-c-start 또는 HEAD) 이후 커밋된 변경
// 예외: docs/tickets/T-102.md(체크 표시), .harness-x-dev/(로컬 상태)
import { execSync } from 'node:child_process';
import { root } from './lib.mjs';
const sh = (c) => execSync(c, { cwd: root, encoding: 'utf8' });
const i = process.argv.indexOf('--since');
let since = i > 0 ? process.argv[i + 1] : null;
if (!since) {
  try {
    sh('git rev-parse -q --verify refs/tags/audit-c-start');
    since = 'audit-c-start';
  } catch {
    since = 'HEAD';
  }
}
const changed = new Set(
  [
    ...sh(`git diff --name-only ${since}`).split('\n'),
    ...sh('git ls-files --others --exclude-standard').split('\n'),
  ].filter(Boolean),
);
const allowed = (p) =>
  p.startsWith('docs/audit/') ||
  p.startsWith('scripts/audit/') ||
  p === 'docs/tickets/T-102.md' ||
  p.startsWith('.harness-x-dev/');
const bad = [...changed].filter((p) => !allowed(p));
if (bad.length) {
  process.stderr.write(
    `guard-readonly: 진단 단계에서 허용되지 않은 변경 ${bad.length}개 (기준 ${since}):\n${bad.map((b) => '  ' + b).join('\n')}\n`,
  );
  process.exit(1);
}
console.log(`guard-readonly: 통과 (기준 ${since}, 변경 ${changed.size}개 모두 docs/audit·scripts/audit 안)`);
