import { SECRET_PATTERNS } from '@harness-x/kernel';
import { describe, expect, it } from 'vitest';
import { buildJudgePrompt } from '../src/questions.js';
import {
  capBytes,
  JUDGE_MAX_VALUE_BYTES,
  looksLikeSourceCode,
  sanitizeJudgeInput,
  utf8Bytes,
} from '../src/sanitize.js';

const req = (expected: string, actual: string, kind = 'text') => ({
  kind,
  expected,
  actual,
  itemTitle: '출력 확인',
  sessionId: 's1',
  authorEngineId: 'codex',
});

function countSecretMatches(s: string): number {
  return SECRET_PATTERNS.reduce((n, p) => n + (s.match(new RegExp(p.re.source, 'g'))?.length ?? 0), 0);
}

describe('E.9 전송 상한·마스킹', () => {
  it('3KB 값 → 2KB 이하 (ASCII·한글 모두, 글자 중간에서 안 끊김)', () => {
    const ascii = 'a'.repeat(3072);
    const korean = '가'.repeat(1024); // 3바이트 × 1024 = 3KB
    const s = sanitizeJudgeInput(req(ascii, korean));
    expect(utf8Bytes(ascii)).toBe(3072);
    expect(utf8Bytes(korean)).toBe(3072);
    expect(utf8Bytes(s.expected)).toBeLessThanOrEqual(JUDGE_MAX_VALUE_BYTES);
    expect(utf8Bytes(s.actual)).toBeLessThanOrEqual(JUDGE_MAX_VALUE_BYTES);
    expect(s.expected).toMatch(/truncated\]$/);
    expect(s.actual).not.toContain('�');
    expect(capBytes('짧음')).toBe('짧음');
  });

  it('비밀 키 패턴 0건 (커널 secrets-mask 재사용) — 프롬프트 전체 기준', () => {
    const secrets = [
      'sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWX',
      'sk-proj-abcdefghijklmnopqrstuvwxyz',
      'AIzaSyA1234567890abcdefghijklmnopqrstuv',
      'ghp_' + 'a'.repeat(36),
      'AKIAABCDEFGHIJKLMNOP',
      'Bearer abcdefghijklmnopqrstuvwxyz0123',
    ];
    const raw = `token=${secrets.join(' and ')}`;
    expect(countSecretMatches(raw)).toBeGreaterThanOrEqual(secrets.length);
    const s = sanitizeJudgeInput({ ...req(raw, raw), itemTitle: `키 ${secrets[0]}` });
    const prompt = buildJudgePrompt(s);
    expect(countSecretMatches(prompt.system + prompt.user)).toBe(0);
    for (const k of secrets) expect(prompt.user).not.toContain(k);
    expect(prompt.user).toContain('[REDACTED:');
  });

  it('소스 코드 본문 금지 — 코드로 보이는 여러 줄 값은 생략, JSON·일반 문장은 유지', () => {
    const code = "import fs from 'node:fs';\nexport function main() {\n  return fs.readFileSync('x');\n}\n";
    expect(looksLikeSourceCode(code)).toBe(true);
    const s = sanitizeJudgeInput(req(code, 'src/main.ts'));
    expect(s.expected).toBe('[source code omitted: 5 lines]');
    expect(s.actual).toBe('src/main.ts');
    const json = '{\n  "a": 1,\n  "b": [1, 2]\n}';
    expect(sanitizeJudgeInput(req(json, json, 'json')).expected).toBe(json);
    expect(looksLikeSourceCode('빌드 성공\n테스트 12개 통과\n경고 없음')).toBe(false);
  });

  it('판정기로 가는 필드는 4개뿐 (sessionId·authorEngineId 제외)', () => {
    const s = sanitizeJudgeInput(req('a', 'b'));
    expect(Object.keys(s).sort()).toEqual(['actual', 'expected', 'itemTitle', 'kind']);
    const p = buildJudgePrompt(s);
    expect(p.user).not.toContain('s1');
    expect(p.user).not.toContain('codex');
  });
});
