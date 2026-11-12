// C6.5 A.24~A.27 실제 출력(스모크 이벤트 종류)과 저장된 녹화(같은 파서로 재생한 이벤트 종류) 비교 → raw/engine-format-diff.json
// 녹화 재생은 실제 어댑터(실행 파일을 'cat 녹화'로 바꿈)로 한다. 바뀐 필드 = 실제에만 / 녹화에만 있는 이벤트 종류
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { rawDir, readJson, root, writeJson } from './lib.mjs';
const imp = (p) => import(pathToFileURL(join(root, 'packages', p)).href);
const ENG = {
  claude: {
    pkg: 'engines/claude-code/dist/index.js',
    make: (m, o) => m.createClaudeCodeEngine(o),
    recs: [
      'packages/engines/claude-code/test/fixtures/hi.real.jsonl',
      'packages/engines/claude-code/test/fixtures/tool-write.jsonl',
    ],
  },
  agy: {
    pkg: 'engines/antigravity/dist/index.js',
    make: (m, o) => m.createAntigravityEngine(o),
    recs: [
      'packages/engines/antigravity/test/fixtures/hi.real.jsonl',
      'packages/engines/antigravity/test/fixtures/tool-denied.real.jsonl',
    ],
  },
  codex: {
    pkg: 'engines/codex/dist/index.js',
    make: (m, o) => m.createCodexEngine(o),
    recs: ['packages/engines/codex/test/fixtures/exec-shell.jsonl'],
  },
};
const out = [];
for (const [name, e] of Object.entries(ENG)) {
  const smoke = readJson(join(rawDir, `smoke-${name}.json`), {});
  const m = await imp(e.pkg);
  const recKinds = new Set();
  for (const rec of e.recs) {
    const dir = mkdtempSync(join(tmpdir(), 'hx-fmt-'));
    try {
      const eng = e.make(m, { command: 'sh', prefixArgs: ['-c', `cat "${join(root, rec)}"`, 'fake'] });
      const r = eng.run({ sessionId: 'fmt', cwd: dir, permission: 'read-only', prompt: 'x' });
      for await (const ev of r.events) recKinds.add(ev.type);
      await r.done;
    } catch (err) {
      recKinds.add(`(재생 실패: ${String(err?.message ?? err).slice(0, 60)})`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  const real = new Set(smoke.eventKinds ?? []);
  const ok = smoke.success === true;
  out.push({
    engine: name,
    smokeSuccess: ok,
    realVersion: smoke.version ?? null,
    realKinds: [...real],
    recordingKinds: [...recKinds],
    onlyInReal: ok ? [...real].filter((k) => !recKinds.has(k)) : [],
    onlyInRecording: ok
      ? [...recKinds].filter((k) => !real.has(k) && !['error', 'turn_end'].includes(k))
      : [],
    note: ok
      ? '실제 출력이 지금 파서로 모두 알려진 이벤트로 바뀜(알 수 없는 종류 0)'
      : '스모크 실패/없음 — 비교 불가',
  });
}
writeJson(join(rawDir, 'engine-format-diff.json'), out);
for (const o of out)
  console.log(
    `${o.engine}: 실제 ${o.realKinds.join(',') || '-'} | 녹화 ${o.recordingKinds.join(',')} | 실제에만 ${o.onlyInReal.join(',') || '없음'}`,
  );
