import { describe, expect, it } from 'vitest';
import { pathComparator } from '../src/comparators/path.js';
import { ctx } from './helpers.js';

const eq = (a: string, b: string, c = ctx(), o = {}) => pathComparator.equals(a, b, c, o);

describe('C.2 path: L1 정규화 + L2 glossary', () => {
  it('정규화 칸 (NFC·구분자·./·끝 슬래시·Windows 대소문자·C:\\ ⇄ /mnt/c)', () => {
    expect(eq('./src/app/', 'src/app')).toMatchObject({ verdict: 'equal', level: 'normalize' });
    expect(eq('하네스'.normalize('NFD'), '하네스')).toMatchObject({ verdict: 'equal', level: 'normalize' });
    expect(eq('src\\app\\main.ts', 'src/app/main.ts').verdict).toBe('equal');
    expect(eq('C:\\Work\\App', '/mnt/c/work/app', ctx(), { cwd: null })).toMatchObject({
      verdict: 'equal',
      level: 'normalize',
    });
    // Windows는 정규화 칸에서 대소문자 무시, posix는 정규화 칸에서는 다르고 사전 칸(표기 관례)에서 같다
    expect(eq('src/App', 'src/app', ctx({ os: 'win' }))).toMatchObject({
      verdict: 'equal',
      level: 'normalize',
    });
    expect(eq('src/App', 'src/app', ctx({ os: 'posix' }))).toMatchObject({
      verdict: 'equal',
      level: 'dictionary',
    });
    expect(eq('src/App', 'src/app', ctx({ os: 'posix' }), { dictionary: false }).verdict).toBe('uncertain');
  });
  it('사전 칸 (glossary·표기 관례·manifest 별칭·사전 쌍)', () => {
    expect(eq('하네스/모바일', 'harness/mobile')).toMatchObject({ verdict: 'equal', level: 'dictionary' });
    expect(eq('harness/mobile/login-screen.kt', 'harness/mobile/LoginScreen.kt')).toMatchObject({
      verdict: 'equal',
      level: 'dictionary',
    });
    expect(eq('app/mobile', 'apps/phone', ctx(), { aliases: ['apps/phone'] }).verdict).toBe('equal');
    expect(eq('a/b', 'c/d', ctx({}, { pairs: [{ kind: 'path', a: 'a/b', b: 'c/d' }] })).level).toBe(
      'dictionary',
    );
  });
  it('확정 못 하면 uncertain (의미 판단 칸으로), dictionary:false면 정규화 칸만', () => {
    const r = eq('하네스/모바일', 'ai/mobile');
    expect(r).toMatchObject({ verdict: 'uncertain', confidence: 0 });
    expect(r.diff).toMatchObject({ expected: '하네스', actual: 'ai' });
    expect(eq('하네스/모바일', 'harness/mobile', ctx(), { dictionary: false }).verdict).toBe('uncertain');
  });
});
