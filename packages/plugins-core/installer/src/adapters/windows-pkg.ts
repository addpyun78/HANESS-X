import {
  CommandAdapter,
  InstallBlockedError,
  type ImportCandidate,
  type InstalledRecord,
  type InstallTarget,
  type SearchHit,
} from '../adapter.js';
import { plainLicense, type InstallPlan, type Pricing } from '../plan.js';

/**
 * Windows 패키지 관리자 어댑터: winget(B.1, 기본) · scoop(B.2) · choco(B.15, 기본 꺼짐)
 */

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/;

function assertId(id: string): void {
  if (!ID_RE.test(id)) throw new InstallBlockedError('INVALID_ID', `패키지 이름이 올바르지 않아요: ${id}`);
}

/** "Key: value" 줄 → 맵 (winget show / scoop info 공용, 소문자 키) */
export function parseKeyValues(text: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i <= 0) continue;
    const k = line.slice(0, i).trim().toLowerCase();
    const v = line.slice(i + 1).trim();
    if (k && !m.has(k) && /^[a-z][a-z /-]*$/.test(k)) m.set(k, v);
  }
  return m;
}

const pricingFrom = (licenseId: string | undefined, sourceUrl: string): Pricing =>
  licenseId && plainLicense(licenseId).plain === '누구나 무료로 쓸 수 있어요.'
    ? {
        tier: 'free',
        note: '오픈소스라 무료예요.',
        checkedAt: new Date().toISOString(),
        sourceUrl,
      }
    : { tier: 'unknown', note: '무료인지 확인하지 못했어요.', checkedAt: '', sourceUrl };

// ── B.1 winget ───────────────────────────────────────────────
export interface WingetShow {
  id: string;
  name: string;
  version: string;
  publisher: string;
  license?: string;
  licenseUrl?: string;
  homepage?: string;
  description?: string;
  agreements: string[];
}

/** `winget show --id <id> -e` 출력 해석 */
export function parseWingetShow(text: string): WingetShow | undefined {
  const head = /Found (.+?) \[([^\]]+)\]/.exec(text);
  if (!head) return undefined;
  const kv = parseKeyValues(text);
  const agreements: string[] = [];
  const idx = text.search(/^Agreements:/m);
  if (idx >= 0)
    for (const line of text.slice(idx).split(/\r?\n/).slice(1)) {
      if (!/^\s+/.test(line)) break;
      if (line.trim()) agreements.push(line.trim());
    }
  return {
    name: head[1]!.trim(),
    id: head[2]!.trim(),
    version: kv.get('version') ?? '',
    publisher: kv.get('publisher') ?? '',
    ...(kv.get('license') ? { license: kv.get('license')! } : {}),
    ...(kv.get('license url') ? { licenseUrl: kv.get('license url')! } : {}),
    ...(kv.get('homepage') ? { homepage: kv.get('homepage')! } : {}),
    ...(kv.get('description') ? { description: kv.get('description')! } : {}),
    agreements,
  };
}

/** `winget search`/`winget list` 표 해석: 머리줄의 열 위치로 자른다 */
export function parseWingetTable(text: string): Record<string, string>[] {
  const lines = text.replace(/\r/g, '').split('\n');
  const sep = lines.findIndex((l) => /^-{5,}/.test(l.trim()));
  if (sep < 1) return [];
  const header = lines[sep - 1]!.replace(/^.*?(Name)/, '$1');
  const cols: { name: string; start: number }[] = [];
  for (const m of header.matchAll(/\S+/g)) cols.push({ name: m[0].toLowerCase(), start: m.index });
  const offset = lines[sep - 1]!.length - header.length;
  const rows: Record<string, string>[] = [];
  for (const raw of lines.slice(sep + 1)) {
    if (!raw.trim()) continue;
    const line = raw.slice(offset);
    const row: Record<string, string> = {};
    cols.forEach((c, i) => {
      row[c.name] = line.slice(c.start, cols[i + 1]?.start ?? undefined).trim();
    });
    rows.push(row);
  }
  return rows;
}

export class WingetAdapter extends CommandAdapter {
  readonly kind = 'winget' as const;

  private async show(id: string): Promise<WingetShow | undefined> {
    const r = await this.ctx.runner(
      { file: 'winget', args: ['show', '--id', id, '-e', '--accept-source-agreements'], host: 'windows' },
      { timeoutMs: 60_000 },
    );
    return r.code === 0 ? parseWingetShow(r.stdout) : undefined;
  }

  async search(query: string): Promise<SearchHit[]> {
    const r = await this.ctx.runner(
      { file: 'winget', args: ['search', query, '--accept-source-agreements'], host: 'windows' },
      { timeoutMs: 60_000 },
    );
    if (r.code !== 0) return [];
    return parseWingetTable(r.stdout)
      .filter((x) => x.id && x.source !== 'msstore')
      .map((x) => ({
        kind: this.kind,
        id: x.id!,
        name: x.name ?? x.id!,
        ...(x.version ? { version: x.version } : {}),
      }));
  }

  async plan(t: InstallTarget): Promise<InstallPlan> {
    assertId(t.id);
    const info = await this.show(t.id);
    if (!info)
      throw new InstallBlockedError(
        'NOT_FOUND_PACKAGE',
        `Windows 앱 저장소에서 ${t.id}을(를) 찾지 못했어요.`,
      );
    const version = t.version ?? info.version;
    if (t.version) assertId(t.version);
    const lic = plainLicense(info.license);
    const sourceUrl = info.homepage ?? `winget:${info.id}`;
    const terms = info.agreements.length
      ? [`설치하면 게시자 약관에 동의하게 돼요: ${info.agreements.join(' / ')}`]
      : [];
    return this.mk({
      name: info.name,
      version,
      target: info.id,
      host: 'windows',
      source: { url: sourceUrl, publisher: info.publisher || info.id.split('.')[0]!, verified: true },
      pricing: pricingFrom(info.license, info.licenseUrl ?? sourceUrl),
      license: info.license ? { id: info.license, plain: lic.plain } : lic,
      etaSec: 60,
      needsAdmin: false,
      changes: [`${info.name}을(를) 설치해요.`, '프로그램 폴더에 파일이 추가돼요.'],
      risks: terms,
      commands: [
        this.fmt([
          'winget',
          'install',
          '--id',
          info.id,
          '-e',
          ...(t.version ? ['--version', t.version] : []),
          '--silent',
          '--accept-package-agreements',
          '--accept-source-agreements',
        ]),
      ],
      uninstall: { commands: this.uninstallCommands({ target: info.id }) },
      verify: { cmd: `winget list --id ${info.id} -e`, expect: info.id },
    });
  }

  uninstallCommands(r: Pick<InstalledRecord, 'target'>): string[] {
    return [`winget uninstall --id ${r.target} -e --silent`];
  }

  async latestVersion(r: InstalledRecord): Promise<string | undefined> {
    return (await this.show(r.target))?.version || undefined;
  }

  async listInstalled(): Promise<ImportCandidate[]> {
    const r = await this.ctx.runner(
      { file: 'winget', args: ['list', '--accept-source-agreements'], host: 'windows' },
      { timeoutMs: 120_000 },
    );
    if (r.code !== 0) return [];
    return parseWingetTable(r.stdout)
      .filter((x) => x.id && x.source === 'winget')
      .map((x) => ({ kind: this.kind, target: x.id!, name: x.name ?? x.id!, version: x.version ?? '' }));
  }
}

// ── B.2 scoop ────────────────────────────────────────────────
export class ScoopAdapter extends CommandAdapter {
  readonly kind = 'scoop' as const;

  async plan(t: InstallTarget): Promise<InstallPlan> {
    assertId(t.id);
    const r = await this.ctx.runner(
      { file: 'scoop', args: ['info', t.id], host: 'windows' },
      { timeoutMs: 60_000 },
    );
    if (r.code !== 0)
      throw new InstallBlockedError('NOT_FOUND_PACKAGE', `scoop에서 ${t.id}을(를) 찾지 못했어요.`);
    const kv = parseKeyValues(r.stdout);
    const licenseId = kv.get('license')?.split(/\s/)[0];
    const website = kv.get('website') ?? '';
    return this.mk({
      name: kv.get('name') ?? t.id,
      version: t.version ?? kv.get('version') ?? '',
      target: t.id,
      host: 'windows',
      source: { url: website, publisher: website ? new URL(website).hostname : 'scoop', verified: false },
      pricing: pricingFrom(licenseId, website),
      license: plainLicense(licenseId),
      etaSec: 60,
      needsAdmin: false,
      changes: [`${t.id}을(를) 내 사용자 폴더(scoop)에 설치해요.`, '관리자 권한은 필요 없어요.'],
      risks: [],
      commands: [this.fmt(['scoop', 'install', t.version ? `${t.id}@${t.version}` : t.id])],
      uninstall: { commands: this.uninstallCommands(t.id) },
      verify: { cmd: `scoop prefix ${t.id}`, expect: '' },
    });
  }

  uninstallCommands(r: Pick<InstalledRecord, 'target'> | string): string[] {
    return [`scoop uninstall ${typeof r === 'string' ? r : r.target}`];
  }
}

// ── B.15 choco (기본 꺼짐) ───────────────────────────────────
export class ChocoAdapter extends CommandAdapter {
  readonly kind = 'choco' as const;

  async plan(t: InstallTarget): Promise<InstallPlan> {
    if (!this.ctx.settings?.chocoEnabled)
      throw new InstallBlockedError(
        'CHOCO_DISABLED',
        'choco는 관리자 권한이 필요해서 꺼져 있어요. 설정에서 켜야 쓸 수 있어요.',
      );
    assertId(t.id);
    return this.mk({
      name: t.name ?? t.id,
      version: t.version ?? '',
      target: t.id,
      host: 'windows',
      source: {
        url: `https://community.chocolatey.org/packages/${t.id}`,
        publisher: 'chocolatey',
        verified: false,
      },
      needsAdmin: true,
      changes: [`${t.id}을(를) 설치해요.`],
      risks: ['관리자 권한으로 실행돼요.'],
      commands: [this.fmt(['choco', 'install', t.id, '-y', ...(t.version ? ['--version', t.version] : [])])],
      uninstall: { commands: this.uninstallCommands(t.id) },
      verify: { cmd: `choco list --exact ${t.id}`, expect: t.id },
    });
  }

  uninstallCommands(r: Pick<InstalledRecord, 'target'> | string): string[] {
    return [`choco uninstall ${typeof r === 'string' ? r : r.target} -y`];
  }
}
