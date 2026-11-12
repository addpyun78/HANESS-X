import {
  CommandAdapter,
  InstallBlockedError,
  type ExecControl,
  type ImportCandidate,
  type InstalledRecord,
  type InstallOutcome,
  type InstallTarget,
  type ProgressFn,
} from '../adapter.js';
import { plainLicense, type InstallPlan, type CommandHost } from '../plan.js';

/**
 * 개발 도구 어댑터: npm 전역(B.3) · Python CLI(B.4) · cargo/go(B.5) · Ollama 모델(B.6) ·
 * VS Code 확장(B.10) · Docker 이미지(B.11) · WSL apt(B.12)
 */

const NAME_RE = /^(@[a-z0-9][\w.-]*\/)?[A-Za-z0-9][\w.-]*$/;
const VER_RE = /^[0-9A-Za-z][\w.+-]*$/;

function check(id: string, re: RegExp = NAME_RE, what = '이름'): void {
  if (!re.test(id)) throw new InstallBlockedError('INVALID_ID', `${what}이 올바르지 않아요: ${id}`);
}

// ── B.3 npm 전역 CLI ─────────────────────────────────────────
export interface NpmView {
  name: string;
  version: string;
  license?: string;
  scripts?: Record<string, string>;
  bin?: Record<string, string> | string;
  dist?: { unpackedSize?: number };
  homepage?: string;
  description?: string;
  author?: string | { name?: string };
}

/** 설치할 때 자동으로 실행되는 스크립트 */
export const NPM_INSTALL_SCRIPTS = ['preinstall', 'install', 'postinstall'] as const;

export class NpmAdapter extends CommandAdapter {
  readonly kind = 'npm-cli' as const;
  protected override defaultHost: CommandHost = 'linux';

  async view(spec: string): Promise<NpmView | undefined> {
    const r = await this.ctx.runner(
      { file: 'npm', args: ['view', spec, '--json'], host: this.host() },
      { timeoutMs: 60_000 },
    );
    if (r.code !== 0) return undefined;
    try {
      const v = JSON.parse(r.stdout) as NpmView | NpmView[];
      return Array.isArray(v) ? v[v.length - 1] : v;
    } catch {
      return undefined;
    }
  }

  async plan(t: InstallTarget): Promise<InstallPlan> {
    check(t.id);
    if (t.version) check(t.version, VER_RE, '버전');
    const info = await this.view(`${t.id}@${t.version ?? 'latest'}`);
    if (!info) throw new InstallBlockedError('NOT_FOUND_PACKAGE', `npm에서 ${t.id}을(를) 찾지 못했어요.`);
    const scripts = NPM_INSTALL_SCRIPTS.filter((s) => info.scripts?.[s]);
    const ignoreScripts = t.options?.ignoreScripts === true;
    const bins =
      typeof info.bin === 'string' ? [info.name.replace(/^@.*\//, '')] : Object.keys(info.bin ?? {});
    const bin = bins[0] ?? info.name.replace(/^@.*\//, '');
    const risks: string[] = [];
    if (scripts.length)
      risks.push(
        ignoreScripts
          ? '설치할 때 자동으로 도는 프로그램을 끄고 설치해요. 일부 기능이 안 될 수 있어요.'
          : `설치할 때 자동으로 도는 프로그램이 있어요(${scripts.join(', ')}). 끄고 설치할 수도 있어요.`,
      );
    const homepage = info.homepage ?? `https://www.npmjs.com/package/${info.name}`;
    const lic = plainLicense(info.license);
    return this.mk({
      name: info.name,
      version: info.version,
      target: info.name,
      host: this.host(),
      source: {
        url: `https://www.npmjs.com/package/${info.name}`,
        publisher: typeof info.author === 'string' ? info.author : (info.author?.name ?? 'npm'),
        verified: false,
      },
      pricing:
        lic.plain === '누구나 무료로 쓸 수 있어요.'
          ? {
              tier: 'free',
              note: '오픈소스라 무료예요.',
              checkedAt: new Date().toISOString(),
              sourceUrl: homepage,
            }
          : { tier: 'unknown', note: '무료인지 확인하지 못했어요.', checkedAt: '', sourceUrl: homepage },
      license: lic,
      sizeMB: info.dist?.unpackedSize ? Math.round((info.dist.unpackedSize / 1048576) * 10) / 10 : null,
      etaSec: 30,
      needsAdmin: false,
      changes: [`명령 '${bin}'을(를) 쓸 수 있게 돼요.`, '버전을 고정해서 설치해요.'],
      risks,
      commands: [
        this.fmt([
          'npm',
          'i',
          '-g',
          `${info.name}@${info.version}`,
          ...(ignoreScripts ? ['--ignore-scripts'] : []),
        ]),
      ],
      uninstall: { commands: this.uninstallCommands({ target: info.name }) },
      verify: { cmd: `${bin} --version`, expect: '' },
    });
  }

  /** 설치 스크립트 경고가 있는 계획인지 (카드의 --ignore-scripts 선택지 표시용) */
  static hasScriptWarning(plan: InstallPlan): boolean {
    return plan.risks.some((r) => r.includes('자동으로 도는 프로그램이 있어요'));
  }

  uninstallCommands(r: Pick<InstalledRecord, 'target'>): string[] {
    return [`npm uninstall -g ${r.target}`];
  }

  async latestVersion(r: InstalledRecord): Promise<string | undefined> {
    return (await this.view(`${r.target}@latest`))?.version;
  }

  async listInstalled(): Promise<ImportCandidate[]> {
    const r = await this.ctx.runner(
      { file: 'npm', args: ['ls', '-g', '--depth=0', '--json'], host: this.host() },
      { timeoutMs: 60_000 },
    );
    try {
      const deps = (JSON.parse(r.stdout) as { dependencies?: Record<string, { version?: string }> })
        .dependencies;
      return Object.entries(deps ?? {})
        .filter(([n]) => n !== 'npm' && n !== 'corepack')
        .map(([n, v]) => ({ kind: this.kind, target: n, name: n, version: v.version ?? '' }));
    } catch {
      return [];
    }
  }
}

// ── B.4 Python CLI: uv tool 우선, 없으면 pipx. 전역 pip 금지 ─────
export class PythonCliAdapter extends CommandAdapter {
  readonly kind = 'python-cli' as const;
  protected override defaultHost: CommandHost = 'linux';

  /** 사용할 설치 도구: uv → pipx (둘 다 없으면 undefined). pip은 절대 쓰지 않는다 */
  installer(): { tool: 'uv' | 'pipx'; host: CommandHost } | undefined {
    const t = this.ctx.detection();
    for (const name of ['uv', 'pipx'] as const)
      if (t[name].available) return { tool: name, host: t[name].host ?? 'linux' };
    return undefined;
  }

  async plan(t: InstallTarget): Promise<InstallPlan> {
    check(t.id);
    if (t.version) check(t.version, VER_RE, '버전');
    const inst = this.installer();
    if (!inst)
      throw new InstallBlockedError(
        'TOOL_MISSING',
        'Python 도구를 설치할 uv나 pipx가 없어요. uv를 먼저 설치해 주세요.',
      );
    const spec = t.version ? `${t.id}==${t.version}` : t.id;
    const commands =
      inst.tool === 'uv'
        ? [this.fmt(['uv', 'tool', 'install', spec])]
        : [this.fmt(['pipx', 'install', spec])];
    return this.mk({
      name: t.name ?? t.id,
      version: t.version ?? '',
      target: t.id,
      host: inst.host,
      source: { url: `https://pypi.org/project/${t.id}/`, publisher: 'pypi', verified: false },
      etaSec: 60,
      needsAdmin: false,
      changes: [`${t.id}을(를) 따로 떨어진 공간에 설치해요. 다른 Python 프로그램과 섞이지 않아요.`],
      risks: [],
      commands,
      uninstall: { commands: this.uninstallCommands({ target: t.id }, inst.tool) },
      verify: { cmd: `${t.id} --version`, expect: '' },
    });
  }

  uninstallCommands(r: Pick<InstalledRecord, 'target'>, tool = this.installer()?.tool ?? 'uv'): string[] {
    return tool === 'uv' ? [`uv tool uninstall ${r.target}`] : [`pipx uninstall ${r.target}`];
  }
}

// ── B.5 cargo / go install (기본 숨김: 설치 도구가 있을 때만 후보) ────
export class CargoAdapter extends CommandAdapter {
  readonly kind = 'cargo' as const;
  protected override defaultHost: CommandHost = 'linux';
  async plan(t: InstallTarget): Promise<InstallPlan> {
    check(t.id);
    if (!this.available().available)
      throw new InstallBlockedError('TOOL_MISSING', 'cargo가 없어서 이 방법은 쓸 수 없어요.');
    return this.mk({
      name: t.name ?? t.id,
      version: t.version ?? '',
      target: t.id,
      host: this.host(),
      source: { url: `https://crates.io/crates/${t.id}`, publisher: 'crates.io', verified: false },
      etaSec: 300,
      needsAdmin: false,
      changes: [`${t.id}을(를) 내려받아 이 컴퓨터에서 직접 만들어 설치해요. 시간이 좀 걸려요.`],
      risks: [],
      commands: [
        this.fmt(['cargo', 'install', t.id, '--locked', ...(t.version ? ['--version', t.version] : [])]),
      ],
      uninstall: { commands: this.uninstallCommands({ target: t.id }) },
      verify: { cmd: `cargo install --list`, expect: t.id },
    });
  }
  uninstallCommands(r: Pick<InstalledRecord, 'target'>): string[] {
    return [`cargo uninstall ${r.target}`];
  }
}

export class GoAdapter extends CommandAdapter {
  readonly kind = 'go' as const;
  protected override defaultHost: CommandHost = 'linux';
  async plan(t: InstallTarget): Promise<InstallPlan> {
    check(t.id, /^[a-z0-9.-]+(\/[\w.-]+)+$/, '모듈 주소');
    if (!this.available().available)
      throw new InstallBlockedError('TOOL_MISSING', 'go가 없어서 이 방법은 쓸 수 없어요.');
    const bin = t.id.split('/').pop()!;
    return this.mk({
      name: t.name ?? bin,
      version: t.version ?? 'latest',
      target: t.id,
      host: this.host(),
      source: { url: `https://pkg.go.dev/${t.id}`, publisher: t.id.split('/')[0]!, verified: false },
      etaSec: 180,
      needsAdmin: false,
      changes: [`${bin}을(를) 이 컴퓨터에서 직접 만들어 설치해요.`],
      risks: [],
      commands: [this.fmt(['go', 'install', `${t.id}@${t.version ?? 'latest'}`])],
      uninstall: { commands: this.uninstallCommands({ target: t.id }) },
      verify: { cmd: `${bin} --version`, expect: '' },
    });
  }
  /** go는 제거 명령이 없다: GOPATH/bin의 실행 파일만 지운다 */
  uninstallCommands(r: Pick<InstalledRecord, 'target'>): string[] {
    return [`go clean -i ${r.target}`];
  }
}

// ── B.6 Ollama 모델 ──────────────────────────────────────────
/** `ollama show` 또는 크기 표기("4.7 GB")에서 MB 꺼내기 */
export function parseSizeMB(text: string): number | undefined {
  const m = /([\d.]+)\s*(GB|MB|GiB|MiB)\b/i.exec(text);
  if (!m) return undefined;
  const n = Number(m[1]);
  return /^g/i.test(m[2]!) ? Math.round(n * 1024) : Math.round(n);
}

export class OllamaModelAdapter extends CommandAdapter {
  readonly kind = 'ollama-model' as const;
  protected override defaultHost: CommandHost = 'linux';

  /** 모델 크기(MB): options.sizeMB → `ollama show` 출력 → 레지스트리 매니페스트(읽기만) */
  async sizeOf(t: InstallTarget): Promise<number | undefined> {
    if (typeof t.options?.sizeMB === 'number') return t.options.sizeMB;
    const r = await this.ctx.runner(
      { file: 'ollama', args: ['show', t.id], host: this.host() },
      { timeoutMs: 30_000 },
    );
    const fromShow = r.code === 0 ? parseSizeMB(r.stdout) : undefined;
    if (fromShow) return fromShow;
    if (!this.ctx.fetch) return undefined;
    const [name, tag = 'latest'] = t.id.split(':');
    try {
      const res = await this.ctx.fetch(`https://registry.ollama.ai/v2/library/${name}/manifests/${tag}`, {
        headers: { accept: 'application/vnd.docker.distribution.manifest.v2+json' },
      });
      if (!res.ok) return undefined;
      const j = (await res.json()) as { layers?: { size?: number }[] };
      const bytes = (j.layers ?? []).reduce((a, l) => a + (l.size ?? 0), 0);
      return bytes ? Math.round(bytes / 1048576) : undefined;
    } catch {
      return undefined;
    }
  }

  /** 디스크 여유가 크기×1.2 미만이면 막는다 */
  async checkDisk(sizeMB: number | undefined, host: CommandHost): Promise<void> {
    if (!sizeMB || !this.ctx.diskFreeMB) return;
    const free = await this.ctx.diskFreeMB(host);
    if (free !== undefined && free < sizeMB * 1.2) {
      const needGB = Math.ceil((sizeMB * 1.2) / 1024);
      const freeGB = Math.floor(free / 1024);
      throw new InstallBlockedError(
        'DISK_FULL',
        `저장 공간이 부족해요. 이 모델은 ${needGB}GB 정도 필요한데 지금 ${freeGB}GB만 남았어요. 파일을 정리한 뒤 다시 해 주세요.`,
      );
    }
  }

  async plan(t: InstallTarget): Promise<InstallPlan> {
    check(t.id, /^[a-z0-9][\w.-]*(\/[\w.-]+)?(:[\w.-]+)?$/i, '모델 이름');
    const sizeMB = await this.sizeOf(t);
    const host = this.host();
    await this.checkDisk(sizeMB, host);
    return this.mk({
      name: t.id,
      version: t.id.split(':')[1] ?? 'latest',
      target: t.id,
      host,
      source: {
        url: `https://ollama.com/library/${t.id.split(':')[0]}`,
        publisher: 'ollama.com',
        verified: true,
      },
      pricing: {
        tier: 'free',
        note: '내 컴퓨터에서 돌아가서 쓸 때 돈이 들지 않아요.',
        checkedAt: new Date().toISOString(),
        sourceUrl: 'https://ollama.com',
      },
      sizeMB: sizeMB ?? null,
      etaSec: sizeMB ? Math.max(60, Math.round(sizeMB / 20)) : null,
      needsAdmin: false,
      changes: [`AI 모델 ${t.id}을(를) 내려받아요.`, '저장 공간을 꽤 차지해요.'],
      risks: [],
      commands: [this.fmt(['ollama', 'pull', t.id])],
      uninstall: { commands: this.uninstallCommands({ target: t.id }) },
      verify: { cmd: 'ollama list', expect: t.id.includes(':') ? t.id : `${t.id}:` },
    });
  }

  override async install(
    plan: InstallPlan,
    onProgress: ProgressFn,
    ctl?: ExecControl,
  ): Promise<InstallOutcome> {
    await this.checkDisk(plan.sizeMB ?? undefined, plan.host);
    return super.install(plan, onProgress, ctl);
  }

  uninstallCommands(r: Pick<InstalledRecord, 'target'>): string[] {
    return [`ollama rm ${r.target}`];
  }

  async listInstalled(): Promise<ImportCandidate[]> {
    const r = await this.ctx.runner(
      { file: 'ollama', args: ['list'], host: this.host() },
      { timeoutMs: 30_000 },
    );
    if (r.code !== 0) return [];
    return r.stdout
      .split(/\r?\n/)
      .slice(1)
      .map((l) => l.trim().split(/\s+/)[0])
      .filter((n): n is string => Boolean(n))
      .map((n) => ({ kind: this.kind, target: n, name: n, version: n.split(':')[1] ?? 'latest' }));
  }
}

// ── B.10 VS Code 확장 ────────────────────────────────────────
export class VscodeExtAdapter extends CommandAdapter {
  readonly kind = 'vscode-ext' as const;
  async plan(t: InstallTarget): Promise<InstallPlan> {
    check(t.id, /^[\w-]+\.[\w.-]+$/, '확장 id');
    const spec = t.version ? `${t.id}@${t.version}` : t.id;
    return this.mk({
      name: t.name ?? t.id,
      version: t.version ?? '',
      target: t.id,
      host: this.host(),
      source: {
        url: `https://marketplace.visualstudio.com/items?itemName=${t.id}`,
        publisher: t.id.split('.')[0]!,
        verified: t.options?.verifiedPublisher === true,
      },
      etaSec: 20,
      needsAdmin: false,
      changes: [`VS Code에 확장 ${t.id}이(가) 추가돼요.`],
      risks: [],
      commands: [this.fmt(['code', '--install-extension', spec])],
      uninstall: { commands: this.uninstallCommands({ target: t.id }) },
      verify: { cmd: 'code --list-extensions', expect: t.id },
    });
  }
  uninstallCommands(r: Pick<InstalledRecord, 'target'>): string[] {
    return [`code --uninstall-extension ${r.target}`];
  }
  async listInstalled(): Promise<ImportCandidate[]> {
    const r = await this.ctx.runner(
      { file: 'code', args: ['--list-extensions', '--show-versions'], host: this.host() },
      { timeoutMs: 60_000 },
    );
    if (r.code !== 0) return [];
    return r.stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const [id, version = ''] = l.split('@');
        return { kind: this.kind, target: id!, name: id!, version };
      });
  }
}

// ── B.11 Docker 이미지 ───────────────────────────────────────
export class DockerImageAdapter extends CommandAdapter {
  readonly kind = 'docker-image' as const;
  protected override defaultHost: CommandHost = 'linux';

  async plan(t: InstallTarget): Promise<InstallPlan> {
    check(t.id, /^[a-z0-9][\w.\-/]*(:[\w.-]+)?(@sha256:[a-f0-9]{64})?$/, '이미지 이름');
    const image = t.version && !t.id.includes(':') ? `${t.id}:${t.version}` : t.id;
    // 크기: manifest inspect(레지스트리 조회만)의 레이어 합
    const r = await this.ctx.runner(
      { file: 'docker', args: ['manifest', 'inspect', image], host: this.host() },
      { timeoutMs: 60_000 },
    );
    let sizeMB: number | null = null;
    if (r.code === 0) {
      const sizes = [...r.stdout.matchAll(/"size"\s*:\s*(\d+)/g)].map((m) => Number(m[1]));
      const layers = sizes.length > 1 ? sizes.slice(1) : sizes; // 첫 값은 config
      const total = layers.reduce((a, b) => a + b, 0);
      if (total) sizeMB = Math.round(total / 1048576);
    }
    const repo = image.split(':')[0]!;
    return this.mk({
      name: image,
      version: image.split(':')[1] ?? 'latest',
      target: image,
      host: this.host(),
      source: {
        url: repo.includes('/') ? `https://hub.docker.com/r/${repo}` : `https://hub.docker.com/_/${repo}`,
        publisher: repo.includes('/') ? repo.split('/')[0]! : 'Docker 공식 이미지',
        verified: !repo.includes('/'),
      },
      sizeMB,
      etaSec: sizeMB ? Math.max(30, Math.round(sizeMB / 20)) : null,
      needsAdmin: false,
      changes: [`Docker 이미지 ${image}을(를) 내려받아요.`],
      risks: [],
      commands: [this.fmt(['docker', 'pull', image])],
      uninstall: { commands: this.uninstallCommands({ target: image }) },
      verify: { cmd: `docker image inspect ${image} --format {{.Id}}`, expect: 'sha256:' },
    });
  }
  uninstallCommands(r: Pick<InstalledRecord, 'target'>): string[] {
    return [`docker rmi ${r.target}`];
  }
}

// ── B.12 WSL apt (sudo 비밀번호는 사용자가 터미널 패널에서 직접) ─────
export const SUDO_NOTICE = '관리자 비밀번호가 필요해요.';

export class WslAptAdapter extends CommandAdapter {
  readonly kind = 'wsl-apt' as const;
  protected override defaultHost: CommandHost = 'linux';

  async plan(t: InstallTarget): Promise<InstallPlan> {
    check(t.id, /^[a-z0-9][a-z0-9+.-]+$/, '패키지 이름');
    return this.mk({
      name: t.id,
      version: t.version ?? '',
      target: t.id,
      host: 'linux',
      interactive: true,
      source: {
        url: `https://packages.ubuntu.com/search?keywords=${t.id}`,
        publisher: 'Ubuntu',
        verified: true,
      },
      pricing: {
        tier: 'free',
        note: '리눅스 기본 저장소라 무료예요.',
        checkedAt: new Date().toISOString(),
        sourceUrl: 'https://packages.ubuntu.com',
      },
      etaSec: 60,
      needsAdmin: true,
      changes: [
        `리눅스(WSL)에 ${t.id}을(를) 설치해요.`,
        SUDO_NOTICE,
        '아래 터미널에 비밀번호를 직접 넣어 주세요.',
      ],
      risks: [],
      commands: [this.fmt(['sudo', 'apt-get', 'install', '-y', t.version ? `${t.id}=${t.version}` : t.id])],
      uninstall: { commands: this.uninstallCommands({ target: t.id }) },
      verify: { cmd: `dpkg -s ${t.id}`, expect: 'install ok installed' },
    });
  }

  /**
   * 하네스는 sudo 명령을 실행하지 않는다: 터미널 패널에 넣을 명령만 알려 주고 사용자를 기다린다.
   * (비밀번호는 사용자가 터미널에 직접 입력 — 하네스는 보지도 저장하지도 않는다)
   */
  override async install(plan: InstallPlan, onProgress: ProgressFn): Promise<InstallOutcome> {
    onProgress({
      stream: 'info',
      data: `${SUDO_NOTICE} 터미널에 아래 명령을 넣어 주세요:\n${plan.commands.join('\n')}\n`,
    });
    return {
      ok: false,
      status: 'needs-user',
      message: `${SUDO_NOTICE} 터미널에서 직접 실행해 주세요. 끝나면 [확인]을 눌러 주세요.`,
      output: '',
    };
  }

  override async uninstall(record: InstalledRecord, onProgress?: ProgressFn): Promise<InstallOutcome> {
    onProgress?.({
      stream: 'info',
      data: `${SUDO_NOTICE} 터미널에 아래 명령을 넣어 주세요:\n${this.uninstallCommands(record).join('\n')}\n`,
    });
    return {
      ok: false,
      status: 'needs-user',
      message: `${SUDO_NOTICE} 터미널에서 직접 실행해 주세요.`,
      output: '',
    };
  }

  uninstallCommands(r: Pick<InstalledRecord, 'target'>): string[] {
    return [`sudo apt-get remove -y ${r.target}`];
  }
}
