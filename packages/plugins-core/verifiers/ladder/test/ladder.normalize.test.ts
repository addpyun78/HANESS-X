import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { normalizePath, pathsEqualL1, type NormalizeOptions } from '../src/normalize.js';

const NFD = (s: string) => s.normalize('NFD');

/** [이름, 입력, 옵션, 기대 키] */
const TABLE: [string, string, NormalizeOptions, string][] = [
  ['그대로', 'harness/mobile', {}, 'harness/mobile'],
  ['한글 NFC 유지', '하네스/모바일', {}, '하네스/모바일'],
  ['한글 NFD → NFC', NFD('하네스/모바일'), {}, '하네스/모바일'],
  ['역슬래시 → 슬래시', 'harness\\mobile\\a.kt', {}, 'harness/mobile/a.kt'],
  ['혼합 구분자', 'harness\\mobile/a.kt', {}, 'harness/mobile/a.kt'],
  ['끝 슬래시 제거', 'harness/mobile/', {}, 'harness/mobile'],
  ['끝 역슬래시 제거', 'harness\\mobile\\', {}, 'harness/mobile'],
  ['중복 슬래시', 'harness//mobile', {}, 'harness/mobile'],
  ['./ 접두', './harness/mobile', {}, 'harness/mobile'],
  ['. 조각', 'harness/./mobile', {}, 'harness/mobile'],
  ['.. 조각', 'harness/x/../mobile', {}, 'harness/mobile'],
  ['앞뒤 공백', '  harness/mobile  ', {}, 'harness/mobile'],
  ['C:\\ → /mnt/c (대소문자 무시)', 'C:\\Users\\Me\\Proj', {}, '/mnt/c/users/me/proj'],
  ['c:/ 소문자 드라이브', 'c:/Users/me', {}, '/mnt/c/users/me'],
  ['드라이브 루트', 'C:\\', {}, '/mnt/c'],
  ['D: 드라이브', 'D:\\Data\\X.txt', {}, '/mnt/d/data/x.txt'],
  ['/mnt/c 대소문자 무시 + 끝 슬래시', '/mnt/c/Users/Me/Proj/', {}, '/mnt/c/users/me/proj'],
  ['/mnt/C 드라이브 문자', '/mnt/C/Work', {}, '/mnt/c/work'],
  ['C:\\ ⇄ /mnt/c 동일 키', 'C:/Users\\me/proj\\', {}, '/mnt/c/users/me/proj'],
  ['리눅스 경로는 대소문자 구분', '/home/u/Harness', {}, '/home/u/Harness'],
  ['대소문자 무시 강제', 'Harness/Mobile', { caseInsensitive: true }, 'harness/mobile'],
  ['대소문자 무시 끔', 'C:\\Users', { caseInsensitive: false }, '/mnt/c/Users'],
  ['상대 경로 + cwd', 'harness/mobile', { cwd: '/ws' }, '/ws/harness/mobile'],
  ['상대 경로 + Windows cwd', 'harness\\mobile', { cwd: 'C:\\WS' }, '/mnt/c/ws/harness/mobile'],
  ['\\\\wsl$ UNC', '\\\\wsl$\\Ubuntu\\home\\u\\x', {}, '/home/u/x'],
  ['\\\\wsl.localhost UNC', '\\\\wsl.localhost\\Ubuntu-22.04\\home\\u\\x', {}, '/home/u/x'],
  ['Windows 경로 안 NFD 한글', NFD('C:\\작업\\하네스'), {}, '/mnt/c/작업/하네스'],
  ['루트', '/', {}, '/'],
];

describe('25.1 L1 정규화 표', () => {
  it(`케이스 ${TABLE.length}개 (≥ 24)`, () => {
    expect(TABLE.length).toBeGreaterThanOrEqual(24);
  });

  it.each(TABLE)('%s', (_name, input, opts, expected) => {
    expect(normalizePath(input, opts)).toBe(expected);
  });

  describe('realpath', () => {
    let dir = '';
    beforeAll(() => {
      dir = mkdtempSync(join(tmpdir(), 'hx-ladder-rp-'));
      mkdirSync(join(dir, 'real', 'mobile'), { recursive: true });
      writeFileSync(join(dir, 'real', 'mobile', 'a.kt'), 'x');
      symlinkSync(join(dir, 'real'), join(dir, 'link'));
    });
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    it('심볼릭 링크 해소', () => {
      const real = normalizePath(join(dir, 'real', 'mobile', 'a.kt'), { realpath: true });
      expect(normalizePath(join(dir, 'link', 'mobile', 'a.kt'), { realpath: true })).toBe(real);
      expect(normalizePath(join(dir, 'link', 'mobile', 'a.kt'))).not.toBe(real);
    });

    it('존재하지 않는 꼬리는 그대로 붙임', () => {
      const real = normalizePath(join(dir, 'real'), { realpath: true });
      expect(normalizePath(join(dir, 'link', 'new', 'b.kt'), { realpath: true })).toBe(`${real}/new/b.kt`);
    });

    it('상대 경로 + cwd + realpath', () => {
      expect(pathsEqualL1('link/mobile/', join(dir, 'real', 'mobile'), { cwd: dir, realpath: true })).toBe(
        true,
      );
    });
  });

  it('pathsEqualL1', () => {
    expect(pathsEqualL1('C:\\WS\\Harness\\Mobile\\', '/mnt/c/ws/harness/mobile')).toBe(true);
    expect(pathsEqualL1(NFD('하네스/모바일'), '하네스/모바일/')).toBe(true);
    expect(pathsEqualL1('harness/mobile', 'ai/mobile')).toBe(false);
  });
});
