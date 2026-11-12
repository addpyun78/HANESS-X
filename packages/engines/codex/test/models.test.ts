import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createCodexEngine, parseCodexModelList } from '../src/engine.js';

const FAKE = fileURLToPath(new URL('./fixtures/fake-codex.mjs', import.meta.url));

describe('T-101 5B.2 Codex app-server 모델 목록 요청 (실제 codex 없이 가짜 서버)', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it('응답 파싱: {data|models:[{model|id}]} → id 목록, 숨김 제외·중복 제거', () => {
    expect(
      parseCodexModelList({
        data: [{ model: 'a' }, { id: 'b' }, { model: 'a' }, { model: 'h', hidden: true }],
      }),
    ).toEqual(['a', 'b']);
    expect(parseCodexModelList({ models: ['x'] })).toEqual(['x']);
    expect(parseCodexModelList(null)).toEqual([]);
  });

  it('listModels(): initialize → model/list만 보내고 끝낸다 (thread/turn 없음 = 모델 호출 없음)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hx-codex-m-'));
    dirs.push(dir);
    const logFile = join(dir, 'log.jsonl');
    const engine = createCodexEngine({ command: process.execPath, prefixArgs: [FAKE] });
    const list = await engine.listModels({ cwd: dir, env: { ...process.env, HX_FAKE_LOG: logFile } });
    expect(list).toEqual(['gpt-5.5-codex', 'gpt-5.5']);
    const methods = readFileSync(logFile, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => (JSON.parse(l) as { method?: string }).method);
    expect(methods).toEqual(['initialize', 'initialized', 'model/list']);
  });
});
