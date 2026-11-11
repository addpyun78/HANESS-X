import { tokenize } from './bash-classifier.js';
import { SHELL_TOOLS } from './plan-gate.js';

/**
 * T-101 3D.4 사람 전용 작업 판별 — 설치·제거·결제·에이전트 저장·Forge 설치.
 * 오토(와 계획) 모드에서는 이런 호출을 실행하지 않고 "돌아오면 확인할 것"에 올린다.
 * 하네스 API 자체도 사람 클릭 토큰(human-gesture-token)이 없으면 403이다 — 이 판별은 그 앞단의 이중 잠금.
 * 함께 "파괴적 명령"(되돌릴 수 없는 삭제·강제 푸시 등)도 판별한다 (오토 모드 금지 목록).
 */

export const HUMAN_ONLY_KINDS = ['install', 'uninstall', 'payment', 'save-agent', 'forge-install'] as const;
export type HumanOnlyKind = (typeof HUMAN_ONLY_KINDS)[number];

/** 쉬운 말 이름 (확인 목록 이유) */
export const HUMAN_ONLY_LABEL: Readonly<Record<HumanOnlyKind, string>> = Object.freeze({
  install: '프로그램 설치',
  uninstall: '프로그램 지우기',
  payment: '결제',
  'save-agent': '에이전트 저장',
  'forge-install': '새 도구 만들어 설치',
});

const SUBJECT: Readonly<Record<HumanOnlyKind, string>> = Object.freeze({
  install: '프로그램 설치는',
  uninstall: '프로그램 지우기는',
  payment: '결제는',
  'save-agent': '에이전트 저장은',
  'forge-install': '새 도구 설치는',
});

export function humanOnlyReason(kind: HumanOnlyKind): string {
  return `${SUBJECT[kind]} 사람이 직접 해야 해서 하지 않았어요. 돌아오시면 확인해 주세요.`;
}

export interface HumanOnlyMatch {
  kind: HumanOnlyKind;
  /** 판정 근거 (기술 정보) */
  why: string;
}

const PKG = new Set(['npm', 'pnpm', 'yarn', 'bun']);
const PKG_INSTALL = new Set(['install', 'i', 'add', 'ci']);
const PKG_REMOVE = new Set(['remove', 'rm', 'uninstall', 'un']);
const SYS_PKG = new Set([
  'apt',
  'apt-get',
  'yum',
  'dnf',
  'pacman',
  'brew',
  'winget',
  'choco',
  'scoop',
  'snap',
  'pip',
  'pip3',
  'pipx',
  'cargo',
  'gem',
  'go',
  'uv',
]);
const SYS_INSTALL = new Set(['install', 'add', '-S', 'get']);
const SYS_REMOVE = new Set(['remove', 'uninstall', 'purge', '-R', 'erase']);
const WRAP = new Set(['sudo', 'env', 'command', 'nohup', 'time', 'doas', 'exec']);
const HX_CLI = new Set(['harness-x', 'hx']);

function base(cmd: string): string {
  return (cmd.split(/[\\/]/).pop() ?? cmd).replace(/\.(exe|cmd|bat)$/i, '');
}

function simpleCommands(cmd: string): string[][] {
  const out: string[][] = [];
  let cur: string[] = [];
  for (const t of tokenize(cmd)) {
    if (t.t === 'word') cur.push(t.v);
    else {
      if (cur.length) out.push(cur);
      cur = [];
    }
  }
  if (cur.length) out.push(cur);
  return out;
}

function classifyWords(words: string[]): HumanOnlyMatch | undefined {
  const w = words.filter((x) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(x));
  while (w.length && WRAP.has(base(w[0]!))) w.shift();
  if (!w.length) return;
  const name = base(w[0]!);
  const args = w.slice(1).filter((a) => !a.startsWith('--'));
  const sub = args.find((a) => !a.startsWith('-') || SYS_INSTALL.has(a) || SYS_REMOVE.has(a));
  if ((name === 'bash' || name === 'sh' || name === 'pwsh' || name === 'powershell') && w.includes('-c')) {
    const inner = w[w.indexOf('-c') + 1];
    return inner ? classifyShell(inner) : undefined;
  }
  if (HX_CLI.has(name)) {
    const [a, b] = args;
    if (a === 'install') return { kind: 'install', why: `${name} install` };
    if (a === 'uninstall' || a === 'remove') return { kind: 'uninstall', why: `${name} ${a}` };
    if (a === 'forge' && b === 'install') return { kind: 'forge-install', why: `${name} forge install` };
    if (a === 'agent' && b === 'save') return { kind: 'save-agent', why: `${name} agent save` };
    return;
  }
  if (PKG.has(name) && sub) {
    if (PKG_INSTALL.has(sub)) return { kind: 'install', why: `${name} ${sub}` };
    if (PKG_REMOVE.has(sub)) return { kind: 'uninstall', why: `${name} ${sub}` };
  }
  if (SYS_PKG.has(name) && sub) {
    if (SYS_INSTALL.has(sub)) return { kind: 'install', why: `${name} ${sub}` };
    if (SYS_REMOVE.has(sub)) return { kind: 'uninstall', why: `${name} ${sub}` };
    if (name === 'uv' && sub === 'pip') return { kind: 'install', why: 'uv pip' };
  }
  if ((name === 'python' || name === 'python3') && w.includes('pip')) {
    const k = w.indexOf('pip');
    if (w[k + 1] === 'install') return { kind: 'install', why: `${name} -m pip install` };
    if (w[k + 1] === 'uninstall') return { kind: 'uninstall', why: `${name} -m pip uninstall` };
  }
  return;
}

/** 셸 명령 문자열 */
export function classifyShell(cmd: string): HumanOnlyMatch | undefined {
  // curl … | sh 같은 원격 설치 스크립트
  if (/\b(curl|wget|iwr|irm|Invoke-WebRequest)\b[^|]*\|\s*(sudo\s+)?(ba|z)?sh\b|\|\s*iex\b/i.test(cmd))
    return { kind: 'install', why: 'remote script | sh' };
  for (const words of simpleCommands(cmd)) {
    const m = classifyWords(words);
    if (m) return m;
  }
  return;
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** 하네스 API 경로 (HTTP 도구로 직접 부르는 경우) */
function classifyHttp(input: Record<string, unknown>): HumanOnlyMatch | undefined {
  const url = typeof input.url === 'string' ? input.url : '';
  if (!url) return;
  const method = (typeof input.method === 'string' ? input.method : 'GET').toUpperCase();
  const path = url.replace(/^[a-z]+:\/\/[^/]+/i, '').split('?')[0]!;
  if (/^\/api\/install\/(execute|import)\b/.test(path)) return { kind: 'install', why: `${method} ${path}` };
  if (/^\/api\/install\/uninstall/.test(path)) return { kind: 'uninstall', why: `${method} ${path}` };
  if (/^\/api\/forge\/.*install/.test(path)) return { kind: 'forge-install', why: `${method} ${path}` };
  if (/^\/api\/agents\/[^/]+$/.test(path) && (method === 'PUT' || method === 'POST'))
    return { kind: 'save-agent', why: `${method} ${path}` };
  if (/(pay|billing|checkout|purchase|subscription)/i.test(path))
    return { kind: 'payment', why: `${method} ${path}` };
  return;
}

/** 도구 이름 (MCP 도구 등) */
function classifyToolName(tool: string): HumanOnlyMatch | undefined {
  const t = tool.toLowerCase();
  if (/forge.*install|install.*forge/.test(t)) return { kind: 'forge-install', why: tool };
  if (/(save[._-]?agent|agent[._-]?save|agents?[._-]put)/.test(t)) return { kind: 'save-agent', why: tool };
  if (/(payment|checkout|purchase|billing|subscribe|\bpay\b|[._-]pay$)/.test(t))
    return { kind: 'payment', why: tool };
  if (/(uninstall|[._-]remove[._-]?(package|tool|plugin))/.test(t)) return { kind: 'uninstall', why: tool };
  if (/(^|[._-])install($|[._-])|installer[._-](execute|run)/.test(t)) return { kind: 'install', why: tool };
  return;
}

export function classifyHumanOnly(
  tool: string,
  input: unknown,
  shellTools: readonly string[] = SHELL_TOOLS,
): HumanOnlyMatch | undefined {
  const a = obj(input);
  if (shellTools.includes(tool)) {
    const raw = typeof input === 'string' ? input : (a.command ?? a.cmd);
    const cmd = Array.isArray(raw)
      ? (raw as unknown[]).map(String).at(-1)!
      : typeof raw === 'string'
        ? raw
        : '';
    return classifyShell(cmd);
  }
  return classifyToolName(tool) ?? classifyHttp(a);
}

// ── 파괴적 명령 ──────────────────────────────────────────────

const DESTRUCTIVE: [RegExp, string][] = [
  [
    /\brm\s+(-[a-zA-Z]*[rR][a-zA-Z]*f?|-[a-zA-Z]*f[a-zA-Z]*[rR])\s+(\/|~|\$HOME|\*|\.\.?)(\s|$|\/\s*$)/,
    'rm -rf 넓은 범위',
  ],
  [/\bgit\s+push\b.*(--force\b|-f\b|--force-with-lease\b)/, 'git push --force'],
  [/\bgit\s+reset\s+--hard\b/, 'git reset --hard'],
  [/\bgit\s+clean\s+-[a-zA-Z]*f/, 'git clean -f'],
  [/(^|[;&|]\s*)(sudo\s+)?(mkfs(\.\w+)?|format)\s+[a-zA-Z/]/, 'mkfs/format'],
  [/\bdd\s+.*\bof=\/dev\//, 'dd of=/dev'],
  [/(^|[;&|]\s*)(sudo\s+)?(shutdown|reboot|halt|poweroff)\b/, 'shutdown'],
  [/\bRemove-Item\b.*-Recurse\b.*-Force\b/i, 'Remove-Item -Recurse -Force'],
  [/:\(\)\s*\{\s*:\|:&\s*\};:/, 'fork bomb'],
];

/** 파괴적 셸 명령이면 근거, 아니면 undefined */
export function destructiveShell(cmd: string): string | undefined {
  for (const [re, why] of DESTRUCTIVE) if (re.test(cmd)) return why;
  return;
}

export const DESTRUCTIVE_REASON = '되돌릴 수 없는 명령이라 오토 모드에서는 하지 않았어요.';
