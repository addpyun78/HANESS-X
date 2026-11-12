// C6.4 엔진 CLI 설치 버전 vs 최신 버전 조회(설치는 하지 않음) → raw/engine-versions.json
// C6.6 Node·pnpm·Tauri 현재 vs 최신 안정판 → raw/runtime-versions.json
import { join } from 'node:path';
import { rawDir, readJson, root, run, writeJson } from './lib.mjs';
const v = (cmd, args) => {
  const r = run(cmd, args, { timeout: 30_000 });
  return r.status === 0 ? (r.stdout || r.stderr).trim().split('\n')[0] : null;
};
const npmLatest = (p) => v('npm', ['view', p, 'version']);
const mode = process.argv[2];
if (mode === 'engines') {
  const snap = (name) => {
    const r = run('snap', ['info', name], { timeout: 30_000 });
    const m = r.stdout?.match(/latest\/stable:\s+(\S+)/);
    return m?.[1] ?? null;
  };
  const out = [
    {
      engine: 'claude',
      installed: v('claude', ['--version']),
      latest: npmLatest('@anthropic-ai/claude-code'),
      source: 'npm @anthropic-ai/claude-code',
    },
    {
      engine: 'codex',
      installed: v('codex', ['--version']),
      latest: npmLatest('@openai/codex'),
      source: 'npm @openai/codex',
    },
    {
      engine: 'agy',
      installed: v('agy', ['--version']),
      latest: snap('antigravity-cli'),
      source: 'snap antigravity-cli',
    },
    {
      engine: 'gemini',
      installed: v('gemini', ['--version']),
      latest: npmLatest('@google/gemini-cli'),
      source: 'npm @google/gemini-cli',
    },
    { engine: 'ollama', installed: v('ollama', ['--version']), latest: null, source: '설치 안 됨' },
  ];
  for (const o of out) o.behind = !!(o.installed && o.latest && !o.installed.includes(o.latest));
  writeJson(join(rawDir, 'engine-versions.json'), out);
  for (const o of out)
    console.log(
      `${o.engine}: 설치 ${o.installed ?? '없음'} / 최신 ${o.latest ?? '?'}${o.behind ? ' (뒤처짐)' : ''}`,
    );
} else if (mode === 'runtime') {
  const nodeIndex = JSON.parse(
    run('curl', ['-s', '-m', '20', 'https://nodejs.org/dist/index.json']).stdout || '[]',
  );
  const lts = nodeIndex.find((x) => x.lts);
  const pkg = readJson(join(root, 'package.json'));
  const tauriCli = readJson(join(root, 'apps', 'desktop', 'package.json'), {});
  const out = {
    node: {
      current: process.version,
      engines: pkg.engines?.node,
      latestLts: lts ? `${lts.version} (${lts.lts})` : null,
      latestCurrent: nodeIndex[0]?.version ?? null,
    },
    pnpm: { current: v('pnpm', ['-v']), packageManager: pkg.packageManager, latest: npmLatest('pnpm') },
    tauri: {
      cli: tauriCli.devDependencies?.['@tauri-apps/cli'] ?? null,
      api: tauriCli.dependencies?.['@tauri-apps/api'] ?? null,
      latestCli: npmLatest('@tauri-apps/cli'),
      latestApi: npmLatest('@tauri-apps/api'),
    },
  };
  writeJson(join(rawDir, 'runtime-versions.json'), out);
  console.log(JSON.stringify(out));
}
