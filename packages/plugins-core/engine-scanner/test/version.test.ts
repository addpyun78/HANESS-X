import { chmodSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultExec, getVersion, parseVersion, VERSION_TIMEOUT_MS } from '@harness-x/engine-scanner';
import { mockExec, ok, tempDir } from './helpers.js';

describe('10.3 --version 파싱', () => {
  it.each([
    ['2.1.3 (Claude Code)', '2.1.3'],
    ['codex-cli 0.46.0', '0.46.0'],
    ['gemini 0.9.0\n', '0.9.0'],
    ['Antigravity v1.12', '1.12.0'],
    ['opencode version 0.15.2-beta.1', '0.15.2-beta.1'],
    ['\nqwen-code/0.0.14 linux-x64 node-v22.23.4', '0.0.14'],
    ['cursor-agent 2025.09.18-7ae6800', '2025.09.18-7ae6800'],
  ])('%j → %s', (input, expected) => {
    expect(parseVersion(input)).toBe(expected);
  });

  it('버전이 없으면 null', () => {
    expect(parseVersion('usage: foo [options]')).toBeNull();
    expect(parseVersion('')).toBeNull();
  });

  it('getVersion: --version 호출, 기본 5초 타임아웃, stderr도 확인', async () => {
    const { exec, calls } = mockExec({
      '/bin/claude --version': ok('2.1.3 (Claude Code)\n'),
      '/bin/agy --version': {
        code: 0,
        stdout: Buffer.alloc(0),
        stderr: Buffer.from('agy 1.4.0\n'),
        timedOut: false,
      },
    });
    expect(await getVersion('/bin/claude', { exec })).toEqual({
      version: '2.1.3',
      raw: '2.1.3 (Claude Code)',
    });
    expect(calls[0]).toEqual({ file: '/bin/claude', args: ['--version'], timeoutMs: VERSION_TIMEOUT_MS });
    expect(VERSION_TIMEOUT_MS).toBe(5000);
    expect((await getVersion('/bin/agy', { exec })).version).toBe('1.4.0');
    expect((await getVersion('/bin/none', { exec })).version).toBeNull();
  });

  it('getVersion: 시간 초과 시 null + 사유', async () => {
    const { exec } = mockExec({
      '/bin/slow --version': { code: null, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), timedOut: true },
    });
    const r = await getVersion('/bin/slow', { exec });
    expect(r.version).toBeNull();
    expect(r.error).toMatch(/시간 초과/);
  });

  it.skipIf(process.platform === 'win32')('실제 실행: 멈추는 프로그램은 타임아웃으로 끊는다', async () => {
    const t = tempDir();
    try {
      const fast = join(t.dir, 'fast');
      const hang = join(t.dir, 'hang');
      writeFileSync(fast, '#!/bin/sh\necho "fast-cli 3.2.1"\n');
      writeFileSync(hang, '#!/bin/sh\nexec sleep 30\n');
      chmodSync(fast, 0o755);
      chmodSync(hang, 0o755);
      expect((await getVersion(fast, { exec: defaultExec })).version).toBe('3.2.1');
      const started = Date.now();
      const r = await getVersion(hang, { exec: defaultExec, timeoutMs: 300 });
      expect(r.version).toBeNull();
      expect(r.error).toMatch(/시간 초과/);
      expect(Date.now() - started).toBeLessThan(3000);
    } finally {
      t.cleanup();
    }
  });
});
