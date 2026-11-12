// C6.8 CLAUDE.md 규칙과 실제 스크립트·폴더 차이 → raw/claude-md-drift.json
// CLAUDE.md에 나오는 경로·pnpm 명령·도구 이름이 실제로 있는지, 반대로 실제 중요한 장치가 CLAUDE.md에 빠졌는지
import { join } from 'node:path';
import { existsSync, rawDir, readFileSync, readJson, root, writeJson } from './lib.mjs';
const md = readFileSync(join(root, 'CLAUDE.md'), 'utf8');
const pkg = readJson(join(root, 'package.json'));
const out = { missingPaths: [], unknownScripts: [], notMentioned: [], checked: [] };
for (const m of md.matchAll(/`([A-Za-z0-9_./-]+\/[A-Za-z0-9_./*<>-]+)`/g)) {
  const p = m[1];
  if (p.includes('<') || p.includes('*')) continue;
  const ok = existsSync(join(root, p.replace(/\/$/, '')));
  out.checked.push({ path: p, exists: ok });
  if (!ok && !/^(audit\/|wip\/|T-102\/)/.test(p) && !/approved\.json$/.test(p)) out.missingPaths.push(p); // approved.json은 D.14에서 생김
}
for (const m of md.matchAll(/pnpm ([a-z:-]+)/g)) {
  const s = m[1];
  if (
    s.startsWith('-') ||
    [
      'test',
      'install',
      'build',
      'dlx',
      'exec',
      'remove',
      'dedupe',
      'vitest',
      'add',
      'outdated',
      'audit',
      'ls',
    ].includes(s)
  )
    continue;
  if (!pkg.scripts?.[s]) out.unknownScripts.push(s);
}
// 실제 장치 중 CLAUDE.md에 안 나오는 것
const devices = {
  'scripts/ticket-gate.mjs (Stop 훅 작업 게이트)': /ticket-gate/,
  'scripts/dev/env.sh (리눅스 Node 22 + pnpm 환경)': /env\.sh/,
  'scripts/dev/tick.sh·check-and-tick.sh (체크 도우미)': /tick\.sh/,
  'packages/kernel/src/settings/registry.ts (새 설정 키 등록 필수)': /settings\/registry/,
  'pnpm test:features (T-102 기능 고정)': /test:features/,
  'pnpm lint (eslint + prettier)': /pnpm lint/,
};
for (const [k, re] of Object.entries(devices)) if (!re.test(md)) out.notMentioned.push(k);
writeJson(join(rawDir, 'claude-md-drift.json'), out);
console.log(
  `claude-md-drift: 경로 ${out.checked.length}개 확인, 없는 경로 ${out.missingPaths.length}, 없는 스크립트 ${out.unknownScripts.length}, 빠진 장치 ${out.notMentioned.length}`,
);
console.log(
  JSON.stringify(out.missingPaths),
  JSON.stringify(out.unknownScripts),
  JSON.stringify(out.notMentioned),
);
