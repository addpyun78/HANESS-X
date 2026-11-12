import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bootSettings } from './settings-screen-fixtures.js';

/** T-101 6C.3 설정 내보내기/가져오기 settings.yaml (키 제외), 가져올 때 검증 — 왕복 테스트 */

const KEY = 'BSAabcdefghijklmnopqrstuv123456';

describe('6C.3 settings.yaml 내보내기/가져오기', () => {
  it('왕복: 내보낸 파일을 새 설치에 가져오면 같은 값 (키는 들어 있지 않음)', async () => {
    const a = await bootSettings();
    let text = '';
    try {
      await a.req('PUT', '/api/settings/secret', { key: 'tools.braveKey', value: KEY });
      await a.req('PUT', '/api/settings', { key: 'judge.semantic', value: 'off' });
      await a.req('PUT', '/api/settings', { key: 'tools.budget', value: 'free-only' });
      await a.req('PUT', '/api/settings', { key: 'checklist.stallBlockTurns', value: 5 });
      const r = await a.req('GET', '/api/settings/export');
      expect(r.body.file).toBe('settings.yaml');
      text = r.body.text;
      expect(text.startsWith('# HARNESS-X 설정 파일 — 키(비밀 값)는 들어 있지 않아요.')).toBe(true);
      expect(text).not.toContain(KEY);
      expect(text).not.toContain('braveKey');
      expect(text).toContain('semantic: off');
    } finally {
      await a.close();
    }
    const b = await bootSettings();
    try {
      const r = await b.req('POST', '/api/settings/import', { text });
      expect(r.status).toBe(200);
      expect(r.body.imported.sort()).toEqual(['checklist.stallBlockTurns', 'judge.semantic', 'tools.budget']);
      expect(JSON.parse(readFileSync(b.file, 'utf8'))).toEqual({
        judge: { semantic: 'off' },
        tools: { budget: 'free-only' },
        checklist: { stallBlockTurns: 5 },
      });
      // 다시 내보내면 같은 파일
      expect((await b.req('GET', '/api/settings/export')).body.text).toBe(text);
      expect(b.kc.size).toBe(0);
    } finally {
      await b.close();
    }
  });

  it('가져올 때 검증: 하나라도 틀리면 아무것도 바꾸지 않고 쉬운 말 목록', async () => {
    const b = await bootSettings();
    try {
      await b.req('PUT', '/api/settings', { key: 'judge.semantic', value: 'off' });
      const before = readFileSync(b.file, 'utf8');
      const bad = [
        'judge:',
        '  semantic: on',
        '  samples: 9',
        'tools:',
        `  braveKey: ${KEY}`,
        'unknown:',
        '  knob: 1',
      ].join('\n');
      const r = await b.req('POST', '/api/settings/import', { text: bad });
      expect(r.status).toBe(400);
      expect(r.body.message).toBe('가져오지 않았어요. 아래 값을 고쳐 주세요.');
      expect(r.body.issues).toEqual([
        { key: 'judge.samples', message: '3 이하로 넣어 주세요.' },
        { key: 'tools.braveKey', message: '키는 가져올 수 없어요. 키 입력 칸에서 넣어 주세요.' },
        { key: 'unknown.knob', message: '알 수 없는 설정이에요.' },
      ]);
      expect(readFileSync(b.file, 'utf8')).toBe(before);
      const broken = await b.req('POST', '/api/settings/import', { text: 'judge: [oops' });
      expect(broken.status).toBe(400);
      expect(broken.body.issues[0].message).toBe(
        '설정 파일 모양이 맞지 않아요. 내보낸 파일을 그대로 넣어 주세요.',
      );
    } finally {
      await b.close();
    }
  });
});
