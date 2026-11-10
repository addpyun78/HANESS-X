import { describe, expect, it } from 'vitest';
import { classifyBash } from '../src/index.js';

// 24.2 쓰기형 Bash 판별기 — 명령 30개 분류 테스트
const WRITE: [string, string[]][] = [
  ['echo hi > out.txt', ['out.txt']],
  ['cat a.txt >> log/b.txt', ['log/b.txt']],
  ['ls 2> err.log', ['err.log']],
  ['npm test &> all.log', ['all.log']],
  ['mv 하네스/모바일/a.kt harness/mobile/a.kt', ['하네스/모바일/a.kt', 'harness/mobile/a.kt']],
  ['cp -r src dist/out', ['dist/out']],
  ['rm -rf build', ['build']],
  ['mkdir -p harness/mobile', ['harness/mobile']],
  ['touch a.kt b.kt', ['a.kt', 'b.kt']],
  ['echo x | tee -a notes.md', ['notes.md']],
  ["sed -i 's/foo/bar/g' src/app.ts", ['src/app.ts']],
  ["sed -i.bak -e 's/a/b/' x.txt", ['x.txt']],
  ['git checkout -- src/app.ts', []],
  ['git apply fix.patch', []],
  ['git -C repo reset --hard HEAD~1', []],
  ['npm install left-pad', []],
  ['pnpm add -D vitest', []],
  ['pip install requests', []],
  ['cd app && yarn install', []],
  ['sudo ln -s /opt/x bin/x', ['bin/x']],
  ['bash -c "echo hi > inner.txt"', ['inner.txt']],
  ['find . -name "*.tmp" -delete', []],
  ['curl -sSL https://example.com/a.sh -o a.sh', ['a.sh']],
  ['tar xzf pkg.tgz', []],
];

const READ = [
  'ls -la',
  'cat README.md | grep harness',
  'git status && git diff --stat',
  'npm test 2>&1 | tail -20',
  'grep -rn "TODO" src > /dev/null',
  'find . -name "*.kt" -type f',
  'echo "a > b" && node -v',
  'git log --oneline -5; git stash list',
];

describe('24.2 classifyBash', () => {
  it('30개 이상 명령 분류', () => {
    expect(WRITE.length + READ.length).toBeGreaterThanOrEqual(30);
  });

  it.each(WRITE)('쓰기: %s', (cmd, targets) => {
    const r = classifyBash(cmd);
    expect(r.write, r.reasons.join(',')).toBe(true);
    expect(r.reasons.length).toBeGreaterThan(0);
    for (const t of targets) expect(r.targets).toContain(t);
  });

  it.each(READ)('읽기: %s', (cmd) => {
    const r = classifyBash(cmd);
    expect(r.write, `${cmd} → ${r.reasons.join(',')}`).toBe(false);
    expect(r.targets).toEqual([]);
  });
});
