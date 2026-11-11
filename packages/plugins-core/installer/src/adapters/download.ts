import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { kindAvailability, type KindAvailability } from '../detect.js';
import {
  InstallBlockedError,
  outcomeOf,
  type AdapterContext,
  type ExecControl,
  type InstalledRecord,
  type InstallerAdapter,
  type InstallOutcome,
  type InstallTarget,
  type ProgressFn,
  type VerifyOutcome,
} from '../adapter.js';
import { makePlan, type InstallPlan, type Pricing } from '../plan.js';

/**
 * B.13 직접 받는 설치 파일(.exe/.msi/.zip)
 *  - HTTPS만, 게시자 공식 도메인 확인
 *  - 임시 격리 폴더(<home>/tmp-downloads/<계획 id>)에 받기, SHA256 계산·게시값 있으면 대조(다르면 차단)
 *  - Get-AuthenticodeSignature로 서명 확인(서명 없으면 빨간 경고, 자동으로 열지 않음)
 *  - .exe/.msi는 설치 화면을 사용자가 직접 진행(무인 설치 옵션 없이 연다), .zip은 지정 폴더에 풀기
 *
 * B.14 가입형 API 서비스: 설치 대신 [가입 페이지 열기] + [키 넣기](키체인), 키 확인 요청 1회
 */

export const DOWNLOAD_EXT_RE = /\.(exe|msi|zip)$/i;

export function sha256File(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

/** host가 공식 도메인(또는 그 하위 도메인)인가 */
export function isOfficialHost(host: string, domains: readonly string[]): boolean {
  const h = host.toLowerCase();
  return domains.some((d) => {
    const x = d.toLowerCase().replace(/^\*\./, '');
    return h === x || h.endsWith(`.${x}`);
  });
}

export interface DownloadAdapterContext extends AdapterContext {
  home: string;
}

interface DownloadMeta {
  sha256?: string;
  extractTo?: string;
}

export class DirectDownloadAdapter implements InstallerAdapter {
  readonly kind = 'direct-download' as const;
  /** 계획 id → 게시 해시·풀 폴더 (계획 원문에는 risks·commands로 보인다) */
  private readonly meta = new Map<string, DownloadMeta>();

  constructor(private readonly ctx: DownloadAdapterContext) {}

  available(): KindAvailability {
    return kindAvailability(this.kind, this.ctx.detection(), this.ctx.settings ?? {});
  }

  async plan(t: InstallTarget): Promise<InstallPlan> {
    let url: URL;
    try {
      url = new URL(t.id);
    } catch {
      throw new InstallBlockedError('INVALID_URL', '주소 형식이 올바르지 않아요.');
    }
    if (url.protocol !== 'https:')
      throw new InstallBlockedError('HTTPS_REQUIRED', '보안 연결(https) 주소에서만 받을 수 있어요.');
    const file = posix.basename(url.pathname);
    const ext = DOWNLOAD_EXT_RE.exec(file)?.[1]?.toLowerCase();
    if (!ext) throw new InstallBlockedError('UNSUPPORTED_FILE', '.exe, .msi, .zip 파일만 받을 수 있어요.');
    const official = Array.isArray(t.options?.officialDomains) ? (t.options.officialDomains as string[]) : [];
    const isOfficial = official.length > 0 && isOfficialHost(url.hostname, official);
    if (official.length && !isOfficial)
      throw new InstallBlockedError(
        'NOT_OFFICIAL',
        `이 주소(${url.hostname})는 게시자 공식 주소가 아니에요. 공식 사이트에서 받아 주세요.`,
      );
    const sha256 = typeof t.options?.sha256 === 'string' ? t.options.sha256.toLowerCase() : undefined;
    if (sha256 && !/^[a-f0-9]{64}$/.test(sha256))
      throw new InstallBlockedError('INVALID_HASH', '게시된 확인값 형식이 올바르지 않아요.');
    const extractTo = typeof t.options?.extractTo === 'string' ? t.options.extractTo : undefined;
    if (ext === 'zip' && !extractTo)
      throw new InstallBlockedError('NEED_FOLDER', '압축을 풀 폴더를 골라 주세요.');
    const pricing: Pricing | undefined =
      t.options?.pricing && typeof t.options.pricing === 'object'
        ? (t.options.pricing as Pricing)
        : undefined;
    const plan = makePlan({
      kind: this.kind,
      name: t.name ?? file,
      version: t.version ?? '',
      target: url.href,
      host: 'windows',
      interactive: ext !== 'zip',
      source: { url: url.href, publisher: url.hostname, verified: isOfficial },
      ...(pricing ? { pricing } : {}),
      needsAdmin: ext !== 'zip',
      changes:
        ext === 'zip'
          ? [`파일을 받아서 ${extractTo} 폴더에 풀어요.`]
          : ['설치 파일을 받아요.', '설치 화면은 직접 보면서 진행해 주세요.'],
      risks: [
        ...(isOfficial ? [] : ['공식 주소인지 확인하지 못했어요.']),
        ...(sha256 ? [] : ['게시된 확인값이 없어서 파일이 맞는지 대조할 수 없어요.']),
      ],
      commands: [
        `download ${url.href}`,
        ...(sha256 ? [`sha256 = ${sha256}`] : []),
        ...(ext === 'zip'
          ? [
              `powershell.exe -NoProfile -Command Expand-Archive -LiteralPath <받은 파일> -DestinationPath "${extractTo}"`,
            ]
          : ['powershell.exe -NoProfile -Command Start-Process -FilePath <받은 파일> -Wait']),
      ],
      uninstall: { commands: [] },
      verify: { cmd: '', expect: '' },
    });
    this.meta.set(plan.id, { ...(sha256 ? { sha256 } : {}), ...(extractTo ? { extractTo } : {}) });
    return plan;
  }

  quarantineDir(planId: string): string {
    return join(this.ctx.home, 'tmp-downloads', planId);
  }

  private async winPath(p: string): Promise<string> {
    if (this.ctx.platform !== 'wsl') return p;
    const r = await this.ctx.runner(
      { file: 'wslpath', args: ['-w', p], host: 'linux' },
      { timeoutMs: 10_000 },
    );
    return r.code === 0 ? r.stdout.trim() : p;
  }

  /** Authenticode 서명 상태 ('Valid'가 아니면 경고) */
  async signatureStatus(file: string): Promise<string> {
    const wp = (await this.winPath(file)).replace(/'/g, "''");
    const r = await this.ctx.runner(
      {
        file: 'powershell.exe',
        args: ['-NoProfile', '-Command', `(Get-AuthenticodeSignature -LiteralPath '${wp}').Status`],
        host: 'windows',
      },
      { timeoutMs: 30_000 },
    );
    return r.code === 0 ? r.stdout.trim() || 'Unknown' : 'Unknown';
  }

  async install(plan: InstallPlan, onProgress: ProgressFn, ctl: ExecControl = {}): Promise<InstallOutcome> {
    const url = new URL(plan.target);
    if (url.protocol !== 'https:')
      return {
        ok: false,
        status: 'failed',
        message: '보안 연결(https) 주소에서만 받을 수 있어요.',
        output: '',
      };
    const fetchFn = this.ctx.fetch ?? fetch;
    const dir = this.quarantineDir(plan.id);
    const tempPaths = [dir];
    mkdirSync(dir, { recursive: true });
    const file = join(dir, posix.basename(url.pathname));
    onProgress({ stream: 'info', data: `받는 중: ${url.href}\n` });
    let res: Response;
    try {
      res = await fetchFn(url.href, { redirect: 'follow', ...(ctl.signal ? { signal: ctl.signal } : {}) });
    } catch (err) {
      rmSync(dir, { recursive: true, force: true });
      const cancelled = ctl.signal?.aborted;
      return {
        ok: false,
        status: cancelled ? 'cancelled' : 'failed',
        message: cancelled ? '취소했어요.' : '파일을 받지 못했어요.',
        output: String(err),
        tempPaths,
      };
    }
    if (!res.ok || (res.url && !res.url.startsWith('https:'))) {
      rmSync(dir, { recursive: true, force: true });
      return {
        ok: false,
        status: 'failed',
        message: '파일을 받지 못했어요.',
        output: `HTTP ${res.status}`,
        tempPaths,
      };
    }
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    const actual = sha256File(file);
    onProgress({ stream: 'info', data: `sha256 ${actual}\n` });
    const meta = this.meta.get(plan.id) ?? {
      sha256: plan.commands.map((c) => /^sha256 = ([a-f0-9]{64})$/.exec(c)?.[1]).find(Boolean),
    };
    if (meta.sha256 && meta.sha256 !== actual) {
      rmSync(dir, { recursive: true, force: true });
      return {
        ok: false,
        status: 'failed',
        message: '받은 파일이 게시된 것과 달라요. 안전을 위해 설치를 막고 파일을 지웠어요.',
        output: `expected ${meta.sha256}\nactual   ${actual}`,
        tempPaths,
      };
    }
    const wp = (await this.winPath(file)).replace(/'/g, "''");
    if (/\.zip$/i.test(file)) {
      const dest = (meta.extractTo ?? '').replace(/'/g, "''");
      const r = await this.ctx.runner(
        {
          file: 'powershell.exe',
          args: [
            '-NoProfile',
            '-Command',
            `Expand-Archive -LiteralPath '${wp}' -DestinationPath '${dest}' -Force`,
          ],
          host: 'windows',
        },
        {
          ...(ctl.signal ? { signal: ctl.signal } : {}),
          onOutput: (stream, data) => onProgress({ stream, data }),
        },
      );
      rmSync(dir, { recursive: true, force: true });
      return r.code === 0
        ? { ok: true, status: 'installed', message: `${meta.extractTo}에 풀었어요.`, output: '' }
        : { ok: false, status: 'failed', message: '압축을 풀지 못했어요.', output: r.stderr, tempPaths };
    }
    const sig = await this.signatureStatus(file);
    if (sig !== 'Valid') {
      const warning = '⚠ 이 파일에는 믿을 수 있는 서명이 없어요. 만든 곳을 확인할 수 없어요.';
      onProgress({ stream: 'info', data: `[경고] ${warning} (${sig})\n` });
      return {
        ok: false,
        status: 'needs-user',
        message: `${warning} 자동으로 열지 않았어요. 정말 설치하려면 파일을 직접 열어 주세요.`,
        output: file,
        warnings: [warning],
        tempPaths,
      };
    }
    // 설치 화면은 사용자가 직접 진행: 무인 설치 옵션 없이 연다
    const r = await this.ctx.runner(
      {
        file: 'powershell.exe',
        args: ['-NoProfile', '-Command', `Start-Process -FilePath '${wp}' -Wait`],
        host: 'windows',
      },
      {
        ...(ctl.signal ? { signal: ctl.signal } : {}),
        onOutput: (stream, data) => onProgress({ stream, data }),
      },
    );
    rmSync(dir, { recursive: true, force: true });
    const o = outcomeOf(r, 'installed', '설치 화면이 끝났어요.');
    return o.ok
      ? o
      : { ...o, ...(o.status === 'failed' ? { message: '설치 화면을 열지 못했어요.' } : {}), tempPaths };
  }

  async verify(): Promise<VerifyOutcome> {
    return { ok: true, output: '' };
  }

  async uninstall(record: InstalledRecord): Promise<InstallOutcome> {
    return {
      ok: false,
      status: 'needs-user',
      message: `${record.name}은(는) Windows 설정 > 앱에서 직접 지워 주세요.`,
      output: '',
    };
  }

  /** 테스트용: 파일 존재 확인 */
  static exists(p: string): boolean {
    return existsSync(p);
  }
}

// ── B.14 가입형 API 서비스 ───────────────────────────────────
export interface ApiServiceSpec {
  id: string;
  name: string;
  signupUrl: string;
  pricing: Pricing;
  /** 키 확인 요청 (키는 header에 넣는다) */
  check: { url: string; header: string; prefix?: string };
  purpose: string;
}

export const KNOWN_API_SERVICES: Record<string, ApiServiceSpec> = {
  'brave-search': {
    id: 'brave-search',
    name: 'Brave Search API',
    signupUrl: 'https://brave.com/search/api/',
    pricing: {
      tier: 'freemium',
      note: '무료 사용량이 있고, 넘으면 돈이 들어요.',
      checkedAt: '',
      sourceUrl: 'https://brave.com/search/api/',
    },
    check: {
      url: 'https://api.search.brave.com/res/v1/web/search?q=test&count=1',
      header: 'X-Subscription-Token',
    },
    purpose: '인터넷 검색',
  },
};

export function apiKeyAccountOf(serviceId: string): string {
  return `api:${serviceId}`;
}

export class ApiServiceAdapter implements InstallerAdapter {
  readonly kind = 'api-service' as const;
  constructor(
    private readonly ctx: AdapterContext,
    private readonly services: Record<string, ApiServiceSpec> = KNOWN_API_SERVICES,
  ) {}

  available(): KindAvailability {
    return { available: true };
  }

  spec(id: string): ApiServiceSpec {
    const s = this.services[id];
    if (!s) throw new InstallBlockedError('NOT_FOUND_PACKAGE', `알 수 없는 서비스예요: ${id}`);
    return s;
  }

  async plan(t: InstallTarget): Promise<InstallPlan> {
    const s = this.spec(t.id);
    return makePlan({
      kind: this.kind,
      name: s.name,
      version: '',
      target: s.id,
      host: 'linux',
      interactive: true,
      source: { url: s.signupUrl, publisher: new URL(s.signupUrl).hostname, verified: true },
      pricing: s.pricing,
      needsAdmin: false,
      changes: ['설치하지 않아요. 가입 페이지를 열어 드려요.', '받은 키는 키체인에만 저장해요.'],
      risks:
        s.pricing.tier === 'free' ? [] : ['쓰는 양에 따라 돈이 들 수 있어요. 하네스는 결제를 하지 않아요.'],
      commands: [`open ${s.signupUrl}`],
      uninstall: { commands: [] },
      verify: { cmd: '', expect: '' },
    });
  }

  async install(plan: InstallPlan, onProgress: ProgressFn): Promise<InstallOutcome> {
    const s = this.spec(plan.target);
    onProgress({ stream: 'info', data: `가입 페이지: ${s.signupUrl}\n` });
    return {
      ok: false,
      status: 'needs-user',
      message: '가입 페이지에서 키를 받은 뒤 [키 넣기]로 넣어 주세요.',
      output: s.signupUrl,
    };
  }

  /** [키 넣기]: 키 확인 요청 1회 → 통과하면 키체인에 저장 */
  async submitKey(serviceId: string, key: string): Promise<{ ok: boolean; message: string }> {
    const s = this.spec(serviceId);
    if (!key.trim()) return { ok: false, message: '키를 넣어 주세요.' };
    const fetchFn = this.ctx.fetch ?? fetch;
    let status = 0;
    try {
      const res = await fetchFn(s.check.url, {
        headers: { [s.check.header]: `${s.check.prefix ?? ''}${key.trim()}` },
      });
      status = res.status;
    } catch {
      return { ok: false, message: '서비스에 연결하지 못했어요. 잠시 뒤 다시 해 주세요.' };
    }
    if (status < 200 || status >= 300) return { ok: false, message: '키가 맞지 않아요. 다시 확인해 주세요.' };
    if (!this.ctx.secrets) return { ok: false, message: '키체인을 쓸 수 없어요.' };
    this.ctx.secrets.set(apiKeyAccountOf(serviceId), key.trim());
    return { ok: true, message: '키가 맞아요. 키체인에 저장했어요.' };
  }

  async verify(plan: InstallPlan): Promise<VerifyOutcome> {
    const ok = Boolean(this.ctx.secrets?.get(apiKeyAccountOf(plan.target)));
    return { ok, output: ok ? 'key stored' : 'no key' };
  }

  async uninstall(record: InstalledRecord): Promise<InstallOutcome> {
    this.ctx.secrets?.delete(apiKeyAccountOf(record.target));
    return { ok: true, status: 'removed', message: '저장한 키를 지웠어요.', output: '' };
  }
}
