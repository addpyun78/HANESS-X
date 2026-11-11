import { makePlan, type InstallKind, type InstallPlan, type CommandHost } from './plan.js';
import type { HostPlatform, Runner } from './runner.js';

/**
 * P2-A.5 설치 도구 감지기 (읽기만: 위치 찾기 + 버전 플래그).
 * Windows 도구는 `where`(WSL에서는 cmd.exe /c where), 리눅스 도구는 `which`.
 * 없으면 그 도구를 쓰는 어댑터는 unavailable이 되고, 그 도구를 먼저 설치하는 계획을 제안한다.
 */

export const INSTALL_TOOLS = [
  'winget',
  'scoop',
  'choco',
  'npm',
  'uv',
  'pipx',
  'cargo',
  'go',
  'ollama',
  'docker',
  'code',
  'wsl',
  'git',
] as const;
export type InstallToolName = (typeof INSTALL_TOOLS)[number];

export interface ToolDetection {
  name: InstallToolName;
  available: boolean;
  /** 찾은 곳 (같은 도구가 양쪽에 있으면 리눅스 우선 — WSL에서 직접 실행 가능) */
  host?: CommandHost;
  path?: string;
  version?: string;
}

export type DetectionTable = Record<InstallToolName, ToolDetection>;

interface ToolSpec {
  /** 확인할 곳 (순서대로) */
  hosts: CommandHost[];
  versionArgs: string[];
}

const SPECS: Record<InstallToolName, ToolSpec> = {
  winget: { hosts: ['windows'], versionArgs: ['--version'] },
  scoop: { hosts: ['windows'], versionArgs: ['--version'] },
  choco: { hosts: ['windows'], versionArgs: ['--version'] },
  npm: { hosts: ['linux', 'windows'], versionArgs: ['--version'] },
  uv: { hosts: ['linux', 'windows'], versionArgs: ['--version'] },
  pipx: { hosts: ['linux', 'windows'], versionArgs: ['--version'] },
  cargo: { hosts: ['linux', 'windows'], versionArgs: ['--version'] },
  go: { hosts: ['linux', 'windows'], versionArgs: ['version'] },
  ollama: { hosts: ['linux', 'windows'], versionArgs: ['--version'] },
  docker: { hosts: ['linux', 'windows'], versionArgs: ['--version'] },
  code: { hosts: ['windows', 'linux'], versionArgs: ['--version'] },
  wsl: { hosts: ['windows'], versionArgs: ['--version'] },
  git: { hosts: ['linux', 'windows'], versionArgs: ['--version'] },
};

/** 각 설치 종류가 필요로 하는 설치 도구 (없으면 무엇이든 가능) */
export const KIND_REQUIRES: Partial<Record<InstallKind, InstallToolName[]>> = {
  winget: ['winget'],
  scoop: ['scoop'],
  choco: ['choco'],
  'npm-cli': ['npm'],
  'python-cli': ['uv', 'pipx'],
  cargo: ['cargo'],
  go: ['go'],
  'ollama-model': ['ollama'],
  'vscode-ext': ['code'],
  'docker-image': ['docker'],
  'wsl-apt': ['wsl'],
  'harness-plugin': ['git'],
  skill: ['git'],
};

/** 버전 출력에서 버전 숫자 하나 꺼내기 */
export function parseVersion(text: string): string | undefined {
  const m = /v?(\d+\.\d+(?:\.\d+)?(?:[-.][0-9A-Za-z]+)*)/.exec(text);
  return m?.[1];
}

export interface DetectOptions {
  runner: Runner;
  platform: HostPlatform;
  tools?: readonly InstallToolName[];
  timeoutMs?: number;
}

function hostsFor(spec: ToolSpec, platform: HostPlatform): CommandHost[] {
  if (platform === 'wsl') return spec.hosts;
  if (platform === 'windows') return spec.hosts.filter((h) => h === 'windows');
  return spec.hosts.filter((h) => h === 'linux');
}

export async function detectTool(name: InstallToolName, o: DetectOptions): Promise<ToolDetection> {
  const spec = SPECS[name];
  const timeoutMs = o.timeoutMs ?? 15_000;
  for (const host of hostsFor(spec, o.platform)) {
    const where =
      host === 'windows'
        ? await o.runner({ file: 'where', args: [name], host }, { timeoutMs })
        : await o.runner({ file: 'which', args: [name], host }, { timeoutMs });
    if (where.code !== 0) continue;
    const path = where.stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.length > 0);
    if (!path) continue;
    // WSL 안의 which가 Windows 쪽(/mnt/c/...)을 찾은 경우는 Windows 도구로 본다
    if (host === 'linux' && path.startsWith('/mnt/') && spec.hosts.includes('windows')) continue;
    const ver = await o.runner({ file: name, args: spec.versionArgs, host }, { timeoutMs });
    const version = parseVersion(`${ver.stdout}\n${ver.stderr}`.replace(/\0/g, ''));
    return { name, available: true, host, path, ...(version ? { version } : {}) };
  }
  return { name, available: false };
}

export async function detectTools(o: DetectOptions): Promise<DetectionTable> {
  const names = o.tools ?? INSTALL_TOOLS;
  const rows = await Promise.all(names.map((n) => detectTool(n, o)));
  const table = Object.fromEntries(
    INSTALL_TOOLS.map((n) => [n, { name: n, available: false } satisfies ToolDetection]),
  ) as DetectionTable;
  for (const r of rows) table[r.name] = r;
  return table;
}

export type KindAvailability =
  | { available: true; tool?: ToolDetection }
  | { available: false; missing: InstallToolName[]; bootstrap?: InstallPlan };

/** 설치 도구를 먼저 설치하는 계획 (winget으로; winget이 없으면 안내만) */
export function bootstrapPlan(tool: InstallToolName, table?: DetectionTable): InstallPlan | undefined {
  const WINGET_IDS: Partial<Record<InstallToolName, [string, string]>> = {
    npm: ['OpenJS.NodeJS.LTS', 'Node.js (npm 포함)'],
    uv: ['astral-sh.uv', 'uv'],
    pipx: ['astral-sh.uv', 'uv (pipx 대신 써요)'],
    cargo: ['Rustlang.Rustup', 'Rust (cargo 포함)'],
    go: ['GoLang.Go', 'Go'],
    ollama: ['Ollama.Ollama', 'Ollama'],
    docker: ['Docker.DockerDesktop', 'Docker Desktop'],
    code: ['Microsoft.VisualStudioCode', 'VS Code'],
    git: ['Git.Git', 'Git'],
  };
  const w = WINGET_IDS[tool];
  if (!w) return undefined;
  if (table && !table.winget.available) return undefined;
  const [id, label] = w;
  return makePlan({
    kind: 'winget',
    name: label,
    version: '',
    target: id,
    host: 'windows',
    source: { url: `winget:${id}`, publisher: id.split('.')[0]!, verified: true },
    needsAdmin: tool === 'docker',
    needsRestart: tool === 'docker',
    changes: [`${label}을(를) 먼저 설치해요. 다른 도구를 설치할 때 필요해요.`],
    risks: [],
    commands: [
      `winget install --id ${id} -e --silent --accept-package-agreements --accept-source-agreements`,
    ],
    uninstall: { commands: [`winget uninstall --id ${id} -e --silent`] },
    verify: { cmd: `${tool} --version`, expect: '' },
  });
}

/** 종류별 사용 가능 여부 (A.5) */
export function kindAvailability(
  kind: InstallKind,
  table: DetectionTable,
  opts: { chocoEnabled?: boolean } = {},
): KindAvailability {
  if (kind === 'choco' && !opts.chocoEnabled) return { available: false, missing: [] };
  const req = KIND_REQUIRES[kind];
  if (!req) return { available: true };
  const found = req.map((n) => table[n]).find((t) => t.available);
  if (found) return { available: true, tool: found };
  const bootstrap = bootstrapPlan(req[0]!, table);
  return { available: false, missing: req, ...(bootstrap ? { bootstrap } : {}) };
}
