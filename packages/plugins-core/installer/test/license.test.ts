import { describe, expect, it } from 'vitest';
import { checkPlainKorean } from '@harness-x/approvals';
import {
  LICENSE_COMMERCIAL_PLAIN,
  LICENSE_COPYLEFT_PLAIN,
  LICENSE_DICTIONARY,
  LICENSE_FREE_PLAIN,
  LICENSE_OTHER_PLAIN,
  UNKNOWN_LICENSE,
  plainLicense,
} from '../src/index.js';

describe('P2-D.5 라이선스 쉬운 설명 사전', () => {
  it('MIT·Apache-2.0 → 무료, GPL → 소스 공개 의무, 상용 → 회사 약관', () => {
    const table: [string, string][] = [
      ['MIT', LICENSE_FREE_PLAIN],
      ['Apache-2.0', LICENSE_FREE_PLAIN],
      ['apache-2.0', LICENSE_FREE_PLAIN],
      ['BSD-3-Clause', LICENSE_FREE_PLAIN],
      ['ISC', LICENSE_FREE_PLAIN],
      ['GPL-3.0', LICENSE_COPYLEFT_PLAIN],
      ['GPL-2.0-only', LICENSE_COPYLEFT_PLAIN],
      ['LGPL-2.1', LICENSE_COPYLEFT_PLAIN],
      ['AGPL-3.0', LICENSE_COPYLEFT_PLAIN],
      ['Proprietary', LICENSE_COMMERCIAL_PLAIN],
      ['Commercial', LICENSE_COMMERCIAL_PLAIN],
      ['WTFPL-ish', LICENSE_OTHER_PLAIN],
    ];
    for (const [id, plain] of table) expect(plainLicense(id), id).toEqual({ id, plain });
    expect(LICENSE_FREE_PLAIN).toBe('누구나 무료로 쓸 수 있어요.');
    expect(LICENSE_COPYLEFT_PLAIN).toBe('무료지만 고쳐서 배포하면 소스 공개 의무가 있어요.');
    expect(LICENSE_COMMERCIAL_PLAIN).toBe('회사 약관을 따라야 해요.');
  });

  it('모르면 unknown (추정으로 무료라고 하지 않는다)', () => {
    for (const v of [undefined, null, '', '  ', 'unknown']) expect(plainLicense(v)).toEqual(UNKNOWN_LICENSE);
  });

  it('사전의 예시는 모두 자기 설명으로 풀리고, 설명은 쉬운 말 검사를 통과한다', () => {
    for (const e of LICENSE_DICTIONARY)
      for (const id of e.examples) expect(plainLicense(id).plain, id).toBe(e.plain);
    for (const t of [
      LICENSE_FREE_PLAIN,
      LICENSE_COPYLEFT_PLAIN,
      LICENSE_COMMERCIAL_PLAIN,
      LICENSE_OTHER_PLAIN,
      UNKNOWN_LICENSE.plain,
    ])
      expect(checkPlainKorean(t).ok, t).toBe(true);
  });
});
