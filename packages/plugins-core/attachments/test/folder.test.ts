import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { checkPlainKorean } from '@harness-x/approvals';
import { afterEach, describe, expect, it } from 'vitest';
import { attachFolder, isIgnored, parseGitignore, scanFolder } from '../src/index.js';
import { makeStore, tempProject } from './helpers.js';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});
const project = () => {
  const p = tempProject();
  cleanups.push(p.cleanup);
  return p.root;
};
function put(root: string, files: Record<string, string>) {
  for (const [f, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, f)), { recursive: true });
    writeFileSync(join(root, f), body);
  }
}

describe('1B.10 폴더 드롭: 파일 목록(.gitignore 존중), 50개 넘으면 묻기', () => {
  it('.gitignore 규칙(*, **, 앞 /, 뒤 /, !, 하위 폴더 .gitignore)을 따른다', () => {
    const root = project();
    put(root, {
      '.gitignore': 'node_modules/\n*.log\n/dist\n!keep.log\nsecret/**/*.key\nbuild/\n',
      'src/a.ts': 'a',
      'src/b.log': 'b',
      'keep.log': 'k',
      'node_modules/x/index.js': 'x',
      'dist/out.js': 'o',
      'src/dist/inner.js': 'i',
      'secret/deep/id.key': 'k',
      'secret/readme.md': 'r',
      build: '파일 이름이 build',
      'docs/.gitignore': 'draft-*\n',
      'docs/draft-1.md': 'd',
      'docs/final.md': 'f',
      '.git/HEAD': 'ref',
    });
    expect(scanFolder(root).files).toEqual([
      '.gitignore',
      'build',
      'docs/.gitignore',
      'docs/final.md',
      'keep.log',
      'secret/readme.md',
      'src/a.ts',
      'src/dist/inner.js',
    ]);
    const rules = parseGitignore('*.tmp\n');
    expect(isIgnored(rules, 'a/b/c.tmp', false)).toBe(true);
    expect(isIgnored(rules, 'a/b/c.txt', false)).toBe(false);
  });

  it('50개 이하는 바로 넣고, 넘으면 확인 전에는 하나도 넣지 않는다', async () => {
    const root = project();
    const folder = join(root, 'in');
    put(folder, Object.fromEntries(Array.from({ length: 51 }, (_v, i) => [`f${i}.txt`, `내용 ${i}`])));
    const store = makeStore(root);
    const r = await attachFolder(store, 's', folder);
    expect(r).toEqual({ status: 'confirm', question: '파일이 많아요. 다 넣을까요?', count: 51 });
    expect(checkPlainKorean(r.status === 'confirm' ? r.question : '').ok).toBe(true);
    expect(store.list('s')).toEqual([]);
    const ok = await attachFolder(store, 's', folder, { confirmed: true });
    expect(ok.status).toBe('added');
    expect(store.list('s')).toHaveLength(51);

    const small = join(root, 'small');
    put(small, { 'a.txt': 'a', 'b/c.md': 'c' });
    const r2 = await attachFolder(store, 's2', small);
    expect(r2.status).toBe('added');
    expect(
      store
        .list('s2')
        .map((a) => a.originalName)
        .sort(),
    ).toEqual(['a.txt', 'c.md']);
  });
});
