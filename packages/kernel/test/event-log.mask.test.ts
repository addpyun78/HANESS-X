import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { EventLog } from '../src/event-log.js';
import { maskSecrets } from '../src/secrets-mask.js';
import { tempDir, textEvent } from './helpers.js';

const KEYS = [
  'sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789',
  'sk-proj-ZZZZZZZZZZZZZZZZZZZZZZZZ',
  'AIzaSyA1234567890abcdefghijklmnopqrstuv',
  'ghp_abcdefghijklmnopqrstuvwxyz0123456789AB',
  'AKIAIOSFODNN7EXAMPLE',
];

describe('비밀 마스킹', () => {
  let cleanup = () => {};
  afterEach(() => cleanup());

  it('키가 포함된 이벤트 기록 후 파일 grep 0건', () => {
    const t = tempDir();
    cleanup = t.cleanup;
    const log = new EventLog({ root: t.dir });
    log.append(textEvent('s1', `키는 ${KEYS[0]} 입니다`));
    log.append({
      id: 'tc',
      ts: '2026-11-10T00:00:00.000Z',
      sessionId: 's1',
      type: 'tool_call',
      callId: 'c',
      tool: 'Bash',
      input: { env: { OPENAI_API_KEY: KEYS[1], GEMINI: KEYS[2] }, list: [KEYS[3], `x ${KEYS[4]}`] },
    });
    log.close();
    const raw = readFileSync(log.sessionFile('s1'), 'utf8');
    for (const k of KEYS) expect(raw.includes(k)).toBe(false);
    expect(raw).toMatch(/\[REDACTED:sk\]/);
    expect(raw).toMatch(/\[REDACTED:google\]/);
  });

  it('일반 문장은 그대로', () => {
    expect(maskSecrets('sk-short and task-list')).toBe('sk-short and task-list');
  });
});
