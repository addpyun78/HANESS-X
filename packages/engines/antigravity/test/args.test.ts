import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AGY_MODES, buildAgyArgs } from '../src/args.js';
import { createAntigravityEngine } from '../src/engine.js';

const fx = (n: string) => fileURLToPath(new URL(`./fixtures/${n}`, import.meta.url));

describe('16.1 agy -p 실행 인자', () => {
  it('기본 인자 스냅샷', () => {
    expect(buildAgyArgs({ prompt: 'hello' })).toMatchInlineSnapshot(`
      [
        "--output-format",
        "stream-json",
        "--mode",
        "accept-edits",
        "-p",
        "hello",
      ]
    `);
  });

  it('모델·모드·재개 스냅샷', () => {
    expect(buildAgyArgs({ prompt: 'go', model: 'gemini-3-pro', permission: 'read-only', resumeId: 'conv-1' }))
      .toMatchInlineSnapshot(`
        [
          "--output-format",
          "stream-json",
          "--mode",
          "plan",
          "--model",
          "gemini-3-pro",
          "--conversation",
          "conv-1",
          "-p",
          "go",
        ]
      `);
  });

  it('full-access → --mode auto + --dangerously-skip-permissions (헤드리스 권한 프롬프트 불가)', () => {
    expect(AGY_MODES).toEqual({
      'read-only': 'plan',
      'workspace-write': 'accept-edits',
      'full-access': 'auto',
    });
    const a = buildAgyArgs({ prompt: 'x', permission: 'full-access' });
    expect(a).toContain('--dangerously-skip-permissions');
    expect(a.slice(a.indexOf('--mode'), a.indexOf('--mode') + 2)).toEqual(['--mode', 'auto']);
    expect(buildAgyArgs({ prompt: 'x', permission: 'workspace-write' })).not.toContain(
      '--dangerously-skip-permissions',
    );
  });

  it('엔진이 실제로 이 인자로 실행한다 (가짜 agy)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hx-agy-args-'));
    try {
      const log = join(dir, 'argv.jsonl');
      const engine = createAntigravityEngine({ command: process.execPath, prefixArgs: [fx('fake-agy.mjs')] });
      const run = engine.run({
        sessionId: 's1',
        cwd: dir,
        prompt: 'Reply with just: hi',
        model: 'gemini-3-flash',
        env: { ...process.env, HX_FAKE_LOG: log, HX_FAKE_STDOUT: fx('hi.real.jsonl') },
      });
      for await (const _ of run.events) void _;
      expect(JSON.parse(readFileSync(log, 'utf8'))).toEqual(
        buildAgyArgs({ prompt: 'Reply with just: hi', model: 'gemini-3-flash' }),
      );
      expect(run.engineSessionId()).toBe('f121ee74-e0ce-4faa-bb1d-4516d573aa23');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
