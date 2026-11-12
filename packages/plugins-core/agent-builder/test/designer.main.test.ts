import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveDesignerEngine } from '../src/designer/settings.js';
import { readBuilderSettings, readMainEngine } from '../src/designer/wire.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('T-101 5D.5 대화로 만들기 설계 AI 기본값 = 메인 따라가기 (5C.3 builder)', () => {
  it('builder.engine 미지정 → settings.json main.engine 사용', () => {
    const home = mkdtempSync(join(tmpdir(), 'hx-designer-main-'));
    dirs.push(home);
    writeFileSync(
      join(home, 'settings.json'),
      JSON.stringify({ main: { engine: 'codex', model: 'gpt-5.5' } }),
    );
    const settings = readBuilderSettings(home);
    expect(settings.engine).toBe('');
    expect(readMainEngine(home)).toBe('codex');
    expect(resolveDesignerEngine(settings, ['claude', 'codex'], 'claude-code', readMainEngine(home))).toEqual(
      {
        engineId: 'codex',
        from: 'main',
      },
    );
  });

  it('builder.engine을 정했으면 그것, 메인이 감지되지 않았으면 세션 기본, 메인 미지정이면 예전 그대로', () => {
    expect(resolveDesignerEngine({ engine: 'claude-code' }, ['claude', 'codex'], undefined, 'codex')).toEqual(
      {
        engineId: 'claude-code',
        from: 'setting',
      },
    );
    expect(resolveDesignerEngine({ engine: 'main' }, ['claude', 'codex'], undefined, 'codex').engineId).toBe(
      'codex',
    );
    expect(resolveDesignerEngine({ engine: '' }, ['claude'], 'claude-code', 'agy')).toEqual({
      engineId: 'claude-code',
      from: 'session-default',
    });
    expect(readMainEngine('/nonexistent-dir-hx')).toBeUndefined();
  });
});
