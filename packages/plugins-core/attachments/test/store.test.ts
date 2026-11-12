import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GITIGNORE_LINE, NoProjectError, ensureGitignore, sessionAttachmentsDir } from '../src/index.js';
import { makeStore, tempProject } from './helpers.js';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

function project() {
  const p = tempProject();
  cleanups.push(p.cleanup);
  return p.root;
}

describe('1A.2 저장 위치: <프로젝트>/.harness-x/attachments/<세션id>/<해시12>/원본 + .gitignore', () => {
  it('프로젝트 폴더 안에 해시 12자 폴더로 저장하고 기록(attachment.json)을 남긴다', async () => {
    const root = project();
    const store = makeStore(root);
    const { attachment: a } = await store.add('s-1', { name: '메모.txt', data: Buffer.from('안녕') });
    const rel = relative(root, a.storedPath).split(sep);
    expect(rel.slice(0, 3)).toEqual(['.harness-x', 'attachments', 's-1']);
    expect(rel[3]).toBe(a.sha256.slice(0, 12));
    expect(rel[4]).toBe('original.txt');
    expect(readFileSync(a.storedPath, 'utf8')).toBe('안녕');
    expect(existsSync(join(root, '.harness-x/attachments/s-1', rel[3]!, 'attachment.json'))).toBe(true);
    expect(store.list('s-1').map((x) => x.id)).toEqual([a.id]);
  });

  it('.gitignore가 없으면 만들고, 있으면 한 줄 덧붙이고, 두 번 넣지 않는다', async () => {
    const root = project();
    await makeStore(root).add('s', { name: 'a.txt', data: Buffer.from('a') });
    expect(readFileSync(join(root, '.gitignore'), 'utf8')).toContain(GITIGNORE_LINE);

    const root2 = project();
    writeFileSync(join(root2, '.gitignore'), 'node_modules');
    expect(ensureGitignore(root2)).toBe(true);
    expect(ensureGitignore(root2)).toBe(false);
    const text = readFileSync(join(root2, '.gitignore'), 'utf8');
    expect(text.startsWith('node_modules\n')).toBe(true);
    expect(text.split(GITIGNORE_LINE).length - 1).toBe(1);

    const root3 = project();
    writeFileSync(join(root3, '.gitignore'), '.harness-x/\n');
    expect(ensureGitignore(root3)).toBe(false);
  });

  it('프로젝트 루트는 주입 함수로 받고, 없으면 NoProjectError', async () => {
    const cur: { root?: string } = {};
    const store = makeStore('', { projectRoot: () => cur.root });
    await expect(store.add('s', { name: 'a.txt', data: Buffer.from('a') })).rejects.toBeInstanceOf(
      NoProjectError,
    );
    cur.root = project();
    const { attachment } = await store.add('s', { name: 'a.txt', data: Buffer.from('a') });
    expect(attachment.storedPath.startsWith(cur.root)).toBe(true);
  });

  it('세션 id로 폴더 밖을 가리킬 수 없다', () => {
    expect(() => sessionAttachmentsDir('/p', '../x')).toThrow();
    expect(() => sessionAttachmentsDir('/p', 'a/b')).toThrow();
  });

  it('로컬 파일 경로로도 넣을 수 있다', async () => {
    const root = project();
    const src = join(root, 'in.md');
    writeFileSync(src, '# 제목');
    const { attachment } = await makeStore(root).add('s', { name: 'in.md', path: src });
    expect(attachment.kind).toBe('text');
    expect(readFileSync(attachment.storedPath, 'utf8')).toBe('# 제목');
  });
});
