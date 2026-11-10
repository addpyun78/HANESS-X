import { describe, expect, it } from 'vitest';
import { lintChecklist, redecomposeMessage } from '../src/lint.js';

describe('21.6 재분해 요청 메시지', () => {
  it('위반 규칙·항목 id 포함 (스냅샷)', () => {
    const res = lintChecklist([
      {
        id: '1',
        title: '로그인 화면 만들고 테스트',
        artifactId: ['art.login', 'art.login-test'],
        acceptance: [{ type: 'llm' }],
        estimate: { files: 3, diffLines: 400 },
        deps: ['2'],
      },
      {
        id: '2',
        title: '세션 저장소 구현',
        artifactId: 'art.session',
        acceptance: [{ type: 'test' }],
        deps: ['1'],
      },
      { id: '3', title: '설정 화면 작성', artifactId: 'art.settings', acceptance: [{ type: 'symbol' }] },
    ]);
    expect(res.ok).toBe(false);
    const msg = redecomposeMessage(res.violations);
    for (const r of ['R1', 'R2', 'R3', 'R4', 'R5']) expect(msg).toContain(`[${r} `);
    expect(msg).toContain('항목 1');
    expect(msg).not.toContain('항목 3');
    expect(msg).toMatchSnapshot();
  });

  it('위반 없으면 빈 문자열', () => {
    expect(redecomposeMessage([])).toBe('');
  });
});
