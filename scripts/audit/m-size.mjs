// A.14 저장소 총량을 4개로 분리(소스·node_modules·.git·나머지) → baseline.json.size
// - 소스 = Git이 추적하는 파일 바이트 합
// - node_modules = 저장소 루트·각 패키지의 node_modules (심볼릭 링크는 따라가지 않음, du -sb)
// - .git = .git 폴더
// - 나머지 = 위 셋 밖의 파일(빌드 결과·로컬 상태 등). 단 .claude/worktrees(작업자 복사본)는 따로 세고
//   개수 × 표본 1개 크기로 어림한다(39개 전체를 걷으면 /mnt/c 위에서 1시간 넘게 걸림)
import { join } from 'node:path';
import { readdirSync } from 'node:fs';
import { mergeOut, root, sh, statSync, mb } from './lib.mjs';
const du = (p) => {
  try {
    return Number(sh(`du -sb --exclude=.claude "${p}" 2>/dev/null | cut -f1`).trim()) || 0;
  } catch (e) {
    return (
      Number(
        String(e.stdout ?? '')
          .trim()
          .split('\t')[0],
      ) || 0
    );
  }
};
const tracked = sh('git ls-files -z').split('\0').filter(Boolean);
let src = 0;
for (const f of tracked) {
  try {
    src += statSync(join(root, f)).size;
  } catch {
    /* 지워진 파일 */
  }
}
const nmDirs = sh(
  `find . -path ./.claude -prune -o -path ./.git -prune -o -name node_modules -type d -prune -print`,
)
  .split('\n')
  .filter(Boolean);
let nm = 0;
for (const d of nmDirs) nm += du(join(root, d));
const git = du(join(root, '.git'));
const total = du(root); // .claude 제외
const other = Math.max(0, total - src - nm - git);
let worktrees = { count: 0, sampleBytes: 0, estimateBytes: 0 };
try {
  const wt = readdirSync(join(root, '.claude', 'worktrees'));
  const sample = wt.length ? du(join(root, '.claude', 'worktrees', wt[0])) : 0;
  worktrees = { count: wt.length, sample: wt[0], sampleBytes: sample, estimateBytes: sample * wt.length };
} catch {
  /* 없음 */
}
const v = {
  sourceBytes: src,
  nodeModulesBytes: nm,
  nodeModulesDirs: nmDirs.length,
  gitBytes: git,
  otherBytes: other,
  worktrees,
  mb: {
    source: mb(src),
    nodeModules: mb(nm),
    git: mb(git),
    other: mb(other),
    worktreesEstimate: mb(worktrees.estimateBytes),
  },
};
mergeOut('size', v);
console.log(JSON.stringify(v.mb));
