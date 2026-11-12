import { describe, expect, it } from 'vitest';
import { countSecretPatterns, redactSecrets, SECRET_PATTERNS } from '../src/settings/diagnostics.js';
import { bootSettings } from './settings-screen-fixtures.js';

/** T-101 6B.13 정보: 버전·업데이트 확인·진단 파일 내보내기(키·첨부 내용 제외) — 내보낸 파일에 키 패턴 0건 */

const BRAVE = 'BSAabcdefghijklmnopqrstuv123456';
const OPENAI = 'sk-proj-ABCDEFGHIJKLMNOP1234567890';

describe('6B.13 정보·진단 파일', () => {
  it('키 모양 글자 가리기: 여러 공급자 모양이 모두 가려진다', () => {
    const text = [
      OPENAI,
      'AIzaSyA1234567890abcdefghijklmnopqr',
      'ghp_abcdefghijklmnopqrstuvwxyz0123',
      'Authorization: Bearer abcdefghijklmnop.qrstu',
      'https://search.local/?api_key=supersecret123',
      BRAVE,
    ].join('\n');
    expect(countSecretPatterns(text)).toBeGreaterThan(0);
    const out = redactSecrets(text);
    expect(countSecretPatterns(out)).toBe(0);
    for (const v of [OPENAI, BRAVE, 'supersecret123']) expect(out).not.toContain(v);
    expect(SECRET_PATTERNS.length).toBeGreaterThan(5);
  });

  it('GET /api/settings/diagnostics: 키체인 값·설정 칸에 붙여 넣은 키가 없고 키 패턴 0건, 버전·플러그인·설정은 있음', async () => {
    const b = await bootSettings({
      about: {
        version: '1.2.3',
        plugins: () => [{ id: 'approvals', version: '0.1.0', enabled: true }],
        engines: () => ['claude-code', 'codex'],
      },
    });
    try {
      expect(
        (await b.req('PUT', '/api/settings/secret', { key: 'tools.braveKey', value: BRAVE })).status,
      ).toBe(200);
      // 실수로 글 칸에 키를 붙여 넣은 경우
      await b.req('PUT', '/api/settings', {
        key: 'tools.searxng',
        value: `https://s.local/?token=${OPENAI}`,
      });
      await b.req('PUT', '/api/settings', { key: 'judge.semantic', value: 'off' });
      const r = await b.req('GET', '/api/settings/diagnostics');
      expect(r.status).toBe(200);
      expect(r.body.file).toBe('harness-x-diagnostics.json');
      const text: string = r.body.text;
      expect(countSecretPatterns(text)).toBe(0);
      expect(text).not.toContain(BRAVE);
      expect(text).not.toContain(OPENAI);
      expect(text).not.toContain(BRAVE.slice(-4) + '"'); // 가린 값 끝 4자도 넣지 않음
      const report = JSON.parse(text);
      expect(report).toMatchObject({
        kind: 'harness-x-diagnostics',
        version: '1.2.3',
        plugins: [{ id: 'approvals' }],
        engines: ['claude-code', 'codex'],
        keys: { 'tools.braveKey': '있음' },
        settings: { 'judge.semantic': { value: 'off', from: 'global' } },
      });
      expect(JSON.stringify(report)).not.toMatch(/attachments\/[^"]*원본/);
    } finally {
      await b.close();
    }
  });

  it('GET /api/settings/about + 업데이트 확인 (확인할 곳이 없으면 쉬운 말, 있으면 새 버전 알림)', async () => {
    const none = await bootSettings({ about: { version: '1.0.0' } });
    try {
      expect((await none.req('GET', '/api/settings/about')).body).toMatchObject({
        version: '1.0.0',
        updateCheck: false,
      });
      expect((await none.req('POST', '/api/settings/update-check')).body).toEqual({
        current: '1.0.0',
        message: '업데이트를 확인할 곳이 아직 없어요. 지금 버전을 그대로 쓰면 돼요.',
      });
    } finally {
      await none.close();
    }
    const b = await bootSettings({
      about: { version: '1.0.0', checkUpdate: async () => ({ latest: '1.1.0' }) },
    });
    try {
      expect((await b.req('POST', '/api/settings/update-check')).body).toMatchObject({
        current: '1.0.0',
        latest: '1.1.0',
        newer: true,
        message: '새 버전 1.1.0이 있어요.',
      });
    } finally {
      await b.close();
    }
  });
});
