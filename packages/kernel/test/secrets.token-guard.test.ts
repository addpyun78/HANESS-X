import fs, { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { readFile as readFileP } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  assertNotTokenFile,
  installTokenFileGuard,
  isTokenFilePath,
  TokenFileAccessError,
} from '../src/secrets.js';
import { tempDir } from './helpers.js';

/**
 * 13.6 — 실제 홈의 토큰 파일은 절대 읽지 않는다.
 * 읽기 시도는 모두 임시 폴더의 가짜 홈(더미 내용)에 대해서만 한다.
 */
describe('13.6 토큰 파일 접근 금지 가드', () => {
  let t: ReturnType<typeof tempDir>;
  let home: string;
  let uninstall: () => void = () => {};
  const fake: Record<string, string> = {};

  beforeEach(() => {
    t = tempDir('hx-guard-');
    home = join(t.dir, 'home');
    for (const rel of [
      '.claude/.credentials.json',
      '.claude/.credentials.json.bak',
      '.codex/auth.json',
      '.gemini/oauth_creds.json',
    ]) {
      const p = join(home, rel);
      mkdirSync(join(p, '..'), { recursive: true });
      writeFileSync(p, 'dummy-not-a-token');
      fake[rel] = p;
    }
    writeFileSync(join(home, '.codex', 'config.toml'), 'model = "x"\n');
    uninstall = installTokenFileGuard({ homes: [home], env: {} });
  });
  afterEach(() => {
    uninstall();
    t.cleanup();
  });

  it('동기 읽기 시도는 TokenFileAccessError', () => {
    for (const p of Object.values(fake)) {
      expect(() => readFileSync(p)).toThrow(TokenFileAccessError);
      expect(() => fs.readFileSync(p, 'utf8')).toThrow(TokenFileAccessError);
      expect(() => fs.openSync(p, 'r')).toThrow(TokenFileAccessError);
      expect(() => fs.copyFileSync(p, join(t.dir, 'copy'))).toThrow(TokenFileAccessError);
    }
  });

  it('비동기·스트림·URL·상대경로 우회·심볼릭 링크도 예외', async () => {
    const p = fake['.codex/auth.json']!;
    await expect(readFileP(p)).rejects.toBeInstanceOf(TokenFileAccessError);
    await expect(fs.promises.open(p)).rejects.toBeInstanceOf(TokenFileAccessError);
    await expect(
      new Promise((res, rej) => fs.readFile(p, (err, d) => (err ? rej(err) : res(d)))),
    ).rejects.toBeInstanceOf(TokenFileAccessError);
    expect(() => fs.createReadStream(p)).toThrow(TokenFileAccessError);
    expect(() => readFileSync(pathToFileURL(p))).toThrow(TokenFileAccessError);
    expect(() => readFileSync(join(home, '.codex', '..', '.codex', 'auth.json'))).toThrow(
      TokenFileAccessError,
    );
    const link = join(t.dir, 'innocent.json');
    symlinkSync(p, link);
    expect(() => readFileSync(link)).toThrow(TokenFileAccessError);
  });

  it('같은 폴더의 다른 파일은 읽을 수 있고, 해제하면 원래 함수로 복구', () => {
    expect(readFileSync(join(home, '.codex', 'config.toml'), 'utf8')).toContain('model');
    uninstall();
    uninstall = () => {};
    expect(fs.readFileSync(fake['.codex/auth.json']!, 'utf8')).toBe('dummy-not-a-token'); // 가짜 파일
  });

  it('기본 규칙은 실제 홈의 토큰 경로를 가리킨다 (경로 판정만, 읽지 않음)', () => {
    const h = homedir();
    expect(isTokenFilePath(join(h, '.claude', '.credentials.json'))).toBe(true);
    expect(isTokenFilePath(join(h, '.codex', 'auth.json'))).toBe(true);
    expect(isTokenFilePath(join(h, '.gemini', 'oauth_creds.json'))).toBe(true);
    expect(isTokenFilePath(join(h, '.claude', 'settings.json'))).toBe(false);
    expect(isTokenFilePath('/x/auth.json', { homes: [], env: { CODEX_HOME: '/x' } })).toBe(true);
    expect(isTokenFilePath('/c/.credentials.json', { homes: [], env: { CLAUDE_CONFIG_DIR: '/c' } })).toBe(
      true,
    );
    expect(() => assertNotTokenFile(join(h, '.codex', 'auth.json'))).toThrow(TokenFileAccessError);
  });
});
