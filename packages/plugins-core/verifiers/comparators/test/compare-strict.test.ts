import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { compareValues, strictReason } from '../src/compare.js';
import { ctx } from './helpers.js';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

describe('D.4 자동 엄격 대상 → 강제 semantic: off', () => {
  it('sha256 비교가 의미 판단으로 안 간다', () => {
    const r = compareValues('text', sha('a'), sha('b'), ctx(), { semantic: 'auto' });
    expect(r).toMatchObject({ semantic: 'off', next: 'fail', verdict: 'different' });
    expect(r.strict).toBe('해시·체크섬(16진 32자 이상)');
    expect(compareValues('auto', `sha256:${sha('x')}`, `sha256:${sha('x')}`, ctx()).next).toBe('pass');
  });
  it('비밀번호·토큰 패턴, lockfile 버전 고정', () => {
    expect(strictReason('password=hunter2', 'password=hunter3')).toBe('비밀번호·토큰 패턴');
    expect(strictReason('sk-ant-abcdefghijklmnop1234', 'x')).toBe('비밀번호·토큰 패턴');
    expect(strictReason('eyJhbGciOi.eyJzdWIiOiIx.c2lnbmF0dXJl', 'x')).toBe('비밀번호·토큰 패턴');
    expect(strictReason('^1.2.0', '1.2.3', 'apps/web/pnpm-lock.yaml')).toBe(
      'lockfile(pnpm-lock.yaml) 버전 고정',
    );
    const v = compareValues('text', 'lodash 4.17.21', 'lodash 4.17.20', ctx(), { file: 'package-lock.json' });
    expect(v).toMatchObject({ semantic: 'off', next: 'fail' });
  });
  it('보통 값은 엄격 대상 아님 (짧은 16진, 일반 문장)', () => {
    expect(strictReason('abc123', 'abc124')).toBeUndefined();
    expect(strictReason('완료', '작업이 끝났습니다')).toBeUndefined();
    expect(compareValues('text', '완료', '끝', ctx()).next).toBe('semantic');
  });
});
