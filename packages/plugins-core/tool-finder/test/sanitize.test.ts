import { describe, expect, it } from 'vitest';
import { ToolFinder, SearchQueryError, assertSafeQuery, sanitizeQuery } from '../src/index.js';
import { hit, NOW, staticProvider, tempHome } from './helpers.js';

describe('P3-B.3 검색어에는 능력 설명만 (코드·파일 내용·비밀 금지)', () => {
  it('능력 설명은 그대로', () => {
    expect(sanitizeQuery('동영상에서 소리만 뽑아내기')).toBe('동영상에서 소리만 뽑아내기');
    expect(sanitizeQuery('  PDF 표를 엑셀로 바꾸기. ')).toBe('PDF 표를 엑셀로 바꾸기');
  });

  it('비밀·경로·주소·코드·붙여 넣은 줄은 빠진다', () => {
    const cases: [string, string][] = [
      ['소리 뽑기 sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123', '소리 뽑기'],
      ['소리 뽑기 ghp_abcdefghijklmnopqrstuvwxyz0123456789AB', '소리 뽑기'],
      ['소리 뽑기 AKIAABCDEFGHIJKLMNOP', '소리 뽑기'],
      ['소리 뽑기 C:\\Users\\me\\secret.mp4', '소리 뽑기'],
      ['소리 뽑기 /home/me/project/src/index.ts', '소리 뽑기'],
      ['소리 뽑기 ./notes.txt', '소리 뽑기'],
      ['소리 뽑기 https://intra.example.com/x', '소리 뽑기'],
      ['소리 뽑기 me@example.com', '소리 뽑기'],
      ['소리 뽑기 const{a}=require("x");', '소리 뽑기'],
      ['소리 뽑기\nimport fs from "node:fs"\nfs.readFileSync(".env")', '소리 뽑기'],
      ['소리 뽑기 aGVsbG8gd29ybGQgdGhpcyBpcyBzZWNyZXQ=', '소리 뽑기'],
    ];
    for (const [input, out] of cases) expect(sanitizeQuery(input), input).toBe(out);
  });

  it('남는 게 없으면 검색하지 않는다, 80자 상한', () => {
    expect(() => sanitizeQuery('/etc/passwd')).toThrow(SearchQueryError);
    expect(() => sanitizeQuery('sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123')).toThrow(SearchQueryError);
    expect(sanitizeQuery('소리 '.repeat(40)).length).toBeLessThanOrEqual(80);
    expect(() => assertSafeQuery('소리\n뽑기')).toThrow(SearchQueryError);
    expect(() => assertSafeQuery('소리 /tmp/a.txt')).toThrow(SearchQueryError);
  });

  it('공급자에게 실제로 간 검색어 검사: 코드·비밀·경로 0건', async () => {
    const t = tempHome();
    try {
      const p = staticProvider('pkg', 'package', [hit({ name: 'ffmpeg', license: 'MIT' })]);
      const f = new ToolFinder({
        home: t.dir,
        packageProviders: [p],
        webProviders: [],
        os: 'wsl',
        now: () => NOW,
      });
      await f.find({
        capability: '동영상 소리 뽑기 ~/work/clip.mp4 token=ghp_abcdefghijklmnopqrstuvwxyz0123456789AB',
        why: '파일 내용: const secret = "sk-abcdefghijklmnopqrstuvwx"',
      });
      expect(p.queries).toEqual(['동영상 소리 뽑기']);
      for (const q of p.queries) expect(q).not.toMatch(/ghp_|sk-|\/|=|clip|secret/);
    } finally {
      t.cleanup();
    }
  });
});
