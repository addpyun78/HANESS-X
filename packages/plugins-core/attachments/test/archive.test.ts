import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ArchiveSafetyError,
  MESSAGES,
  convertArchive,
  createZip,
  extractArchive,
  isUnsafeEntryName,
  parse7zList,
} from '../src/index.js';
import { addAndConvert, fakeTools, tempProject } from './helpers.js';
import { createZipPlain, sevenZip, tar } from './samples.js';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});
const project = () => {
  const p = tempProject();
  cleanups.push(p.cleanup);
  return p.root;
};

/** 악성 1: 경로 탈출 (../ 와 절대 경로) */
export const traversalZip = () =>
  createZip([
    { name: 'ok.txt', data: '정상' },
    { name: '../../evil.txt', data: '폴더 밖에 쓰기' },
  ]);
/** 악성 2: 압축 폭탄 (0으로 채운 20MB → 수십 KB) */
export const bombZip = () => createZip([{ name: 'zeros.bin', data: Buffer.alloc(20 * 1024 * 1024) }]);

describe('1B.9 압축: 목록만, 풀기는 요청 시 — 경로 탈출·압축 폭탄 차단', () => {
  it('zip·tar·tar.gz는 목록만 만들고 풀지 않는다', async () => {
    const root = project();
    const z = await addAndConvert(root, '자료.zip', createZipPlain(), { archive: convertArchive });
    const listing = readFileSync(z.representations[0]!.path, 'utf8');
    expect(z.representations[0]!.form).toBe('listing');
    expect(listing).toContain('- docs/a.txt (9 bytes)');
    expect(listing).toContain('- b.md (3 bytes)');
    expect(z.warnings.map((w) => w.message)).toEqual([MESSAGES.archiveListOnly]);
    const dir = join(z.storedPath, '..');
    expect(readdirSync(dir).sort()).toEqual(['attachment.json', 'listing.md', 'original.zip']);

    const t = await addAndConvert(project(), '묶음.tar.gz', gzipSync(tar({ 'a.txt': '가' })), {
      archive: convertArchive,
    });
    expect(readFileSync(t.representations[0]!.path, 'utf8')).toContain('- a.txt (3 bytes)');
  });

  it('악성 zip 1: 경로 탈출 — 목록에 경고, 풀기 요청은 아무것도 쓰지 않고 거절', async () => {
    const root = project();
    const a = await addAndConvert(root, '선물.zip', traversalZip(), { archive: convertArchive });
    expect(a.warnings.map((w) => w.code)).toContain('unsafe-path');
    const dest = join(root, 'out');
    expect(() => extractArchive(a, dest)).toThrow(ArchiveSafetyError);
    expect(() => extractArchive(a, dest)).toThrow(MESSAGES.archiveUnsafePath);
    expect(existsSync(dest)).toBe(false);
    expect(existsSync(join(root, '..', 'evil.txt'))).toBe(false);
    expect(['../x', '..\\x', '/etc/passwd', 'C:/win', 'a/../../b'].every(isUnsafeEntryName)).toBe(true);
    expect(isUnsafeEntryName('a/b..c/d')).toBe(false);
  });

  it('악성 zip 2: 압축 폭탄 — 압축률·총 크기 상한으로 거절, 적힌 크기를 속여도 실제 풀기에서 막힘', async () => {
    const root = project();
    const a = await addAndConvert(root, '작은파일.zip', bombZip(), { archive: convertArchive });
    expect(a.sizeBytes).toBeLessThan(100 * 1024);
    expect(a.warnings.map((w) => w.code)).toContain('bomb');
    expect(() => extractArchive(a, join(root, 'out'))).toThrow(MESSAGES.archiveBomb);
    expect(existsSync(join(root, 'out'))).toBe(false);

    // 중앙 디렉터리의 크기를 1바이트로 속인 폭탄: 실제로 풀 때 한도에서 멈춘다
    const lying = bombZip();
    const cen = lying.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    lying.writeUInt32LE(1, cen + 24);
    const b = await addAndConvert(project(), '속임.zip', lying, { archive: convertArchive });
    expect(() =>
      extractArchive(b, join(root, 'out2'), { maxTotalBytes: 1024 * 1024, maxFiles: 10, maxRatio: 200 }),
    ).toThrow(MESSAGES.archiveBomb);
  });

  it('정상 zip은 요청하면 안전하게 풀린다', async () => {
    const root = project();
    const a = await addAndConvert(root, '자료.zip', createZipPlain(), { archive: convertArchive });
    const dest = join(root, 'out');
    expect(extractArchive(a, dest).sort()).toEqual(['b.md', join('docs', 'a.txt')]);
    expect(readFileSync(join(dest, 'docs/a.txt'), 'utf8')).toBe('가나다');
  });

  it('7z: 도구가 있으면 목록, 없으면 안내 + 도구 찾기 카드', async () => {
    const needs: unknown[] = [];
    const none = await addAndConvert(
      project(),
      'a.7z',
      sevenZip(),
      { archive: convertArchive },
      {
        tools: fakeTools(),
        onToolNeeded: (n) => needs.push(n),
      },
    );
    expect(none.warnings.map((w) => w.message)).toEqual([MESSAGES.archiveNeedsTool]);
    expect(needs).toHaveLength(1);
    const out =
      'Path = a.7z\nType = 7z\n\nPath = 문서/계획.txt\nSize = 12\nPacked Size = 10\n\nPath = 문서\nFolder = +\nSize = 0\n';
    expect(parse7zList(out)).toEqual([
      { name: '문서/계획.txt', size: 12, compressedSize: 10, isDir: false },
      { name: '문서', size: 0, isDir: true },
    ]);
    const tools = fakeTools({ '7z': () => ({ stdout: Buffer.from(out) }) });
    const has = await addAndConvert(project(), 'a.7z', sevenZip(), { archive: convertArchive }, { tools });
    expect(tools.calls[0]!.args.slice(0, 2)).toEqual(['l', '-slt']);
    expect(readFileSync(has.representations[0]!.path, 'utf8')).toContain('문서/계획.txt');
  });
});
