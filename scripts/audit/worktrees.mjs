// G(C3-001) 지난 작업자 복사본 정리 — 사본마다 ①저장 안 된 변경 없음 ②그 브랜치가 master에 모두 들어 있음
// usage: node scripts/audit/worktrees.mjs [--apply]   (기본: 미리보기만) → raw/worktrees.json
// --apply: 둘 다 맞는 사본만 `git worktree remove` + `git branch -d`(안 합친 작업이면 git이 거부). git stash는 건드리지 않음
import { join } from 'node:path';
import { rawDir, root, run, writeJson } from './lib.mjs';
const apply = process.argv.includes('--apply');
const git = (args, cwd = root) => run('git', args, { cwd });
const list = git(['worktree', 'list', '--porcelain']).stdout.split('\n\n').filter(Boolean).map((b) => {
  const o = {};
  for (const l of b.split('\n')) {
    const [k, ...v] = l.split(' ');
    o[k] = v.join(' ') || true;
  }
  return o;
});
const out = [];
for (const w of list) {
  if (!w.worktree || !w.worktree.includes('/.claude/worktrees/')) continue;
  const branch = String(w.branch ?? '').replace('refs/heads/', '');
  const dirty = git(['status', '--porcelain'], w.worktree);
  const clean = dirty.status === 0 && dirty.stdout.trim() === '';
  const merged = git(['merge-base', '--is-ancestor', w.HEAD, 'master']).status === 0;
  const rec = { path: w.worktree.replace(root + '/', ''), branch, head: w.HEAD, clean, mergedIntoMaster: merged, action: clean && merged ? 'remove' : 'keep', why: !clean ? '저장 안 된 변경 있음' : !merged ? 'master에 안 합친 커밋 있음' : '' };
  if (apply && rec.action === 'remove') {
    const r1 = git(['worktree', 'remove', w.worktree]);
    rec.removed = r1.status === 0;
    if (!rec.removed) rec.error = (r1.stderr || '').trim().slice(0, 200);
    if (rec.removed && branch) {
      const r2 = git(['branch', '-d', branch]);
      rec.branchDeleted = r2.status === 0;
      if (!rec.branchDeleted) rec.branchError = (r2.stderr || '').trim().slice(0, 200);
    }
  }
  out.push(rec);
}
writeJson(join(rawDir, apply ? 'worktrees-applied.json' : 'worktrees.json'), out);
const c = (k) => out.filter((o) => o.action === k).length;
console.log(`worktrees: ${out.length}개 → 지움 대상 ${c('remove')}, 남김 ${c('keep')}${apply ? `, 실제 지움 ${out.filter((o) => o.removed).length}, 브랜치 지움 ${out.filter((o) => o.branchDeleted).length}` : ' (미리보기)'}`);
for (const o of out.filter((o) => o.action === 'keep')) console.log(`  남김 ${o.path} [${o.branch}] ${o.why}`);
