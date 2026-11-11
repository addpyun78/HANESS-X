import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { MANIFEST_FILE, TrustStore, type TrustLevel } from '@harness-x/kernel';
import { PluginManifestSchema } from '@harness-x/protocol';
import { validateSkillMd } from '@harness-x/sdk';
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
import { makePlan, type InstallPlan } from '../plan.js';

/**
 * B.9 하네스 플러그인·스킬: 격리 폴더로 git clone(깊이 1) → 매니페스트 검증(T-006 스키마) →
 * <home>/plugins/<id> (또는 <home>/skills/<이름>)로 옮김. 사용자 출처라 로더가 미서명·격리 등급(T-062)으로 실행한다.
 * 코드는 실행하지 않는다(설치 스크립트 없음).
 */

export const GIT_URL_RE = /^https:\/\/(github\.com|gitlab\.com|codeberg\.org)\/[\w.-]+\/[\w.-]+?(\.git)?\/?$/;

export interface PluginAdapterContext extends AdapterContext {
  home: string;
}

export type ValidationResult =
  { ok: true; id: string; version: string; displayName?: string } | { ok: false; reason: string };

/** 플러그인 폴더 검증 (harness-plugin.json) */
export function validatePluginDir(dir: string): ValidationResult {
  const f = join(dir, MANIFEST_FILE);
  if (!existsSync(f)) return { ok: false, reason: `${MANIFEST_FILE}이 없어요.` };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(f, 'utf8'));
  } catch {
    return { ok: false, reason: `${MANIFEST_FILE}을 읽을 수 없어요(형식 오류).` };
  }
  const r = PluginManifestSchema.safeParse(raw);
  if (!r.success)
    return {
      ok: false,
      reason: `플러그인 설명 파일이 올바르지 않아요: ${r.error.issues.map((i) => `${i.path.join('.') || '(root)'} ${i.message}`).join('; ')}`,
    };
  if (r.data.apiVersion !== 1) return { ok: false, reason: '지원하지 않는 플러그인 버전이에요.' };
  return {
    ok: true,
    id: r.data.id,
    version: r.data.version,
    ...(r.data.displayName ? { displayName: r.data.displayName } : {}),
  };
}

/** 스킬 폴더 검증 (SKILL.md 프런트매터) */
export function validateSkillDir(dir: string): ValidationResult {
  const f = join(dir, 'SKILL.md');
  if (!existsSync(f)) return { ok: false, reason: 'SKILL.md가 없어요.' };
  const r = validateSkillMd(readFileSync(f, 'utf8'));
  if (!r.ok || !r.frontmatter)
    return { ok: false, reason: `스킬 설명이 올바르지 않아요: ${r.errors.join('; ')}` };
  return { ok: true, id: r.frontmatter.name, version: '' };
}

/** 설치된 플러그인의 신뢰 등급 (사용자 출처 → 승격 전에는 unsigned-isolated) */
export function trustLevelOfInstalled(id: string, sha256: string, trustFile?: string): TrustLevel {
  return new TrustStore(trustFile).levelOf({ id, sha256, origin: 'user' });
}

export class HarnessPluginAdapter implements InstallerAdapter {
  readonly kind: 'harness-plugin' | 'skill';
  /** 계획 id → 설치 폴더 */
  private readonly installed = new Map<string, string>();
  constructor(
    protected readonly ctx: PluginAdapterContext,
    kind: 'harness-plugin' | 'skill' = 'harness-plugin',
  ) {
    this.kind = kind;
  }

  available(): KindAvailability {
    return kindAvailability(this.kind, this.ctx.detection(), this.ctx.settings ?? {});
  }

  private gitHost() {
    return this.ctx.detection().git.host ?? 'linux';
  }

  installDir(name: string): string {
    return join(this.ctx.home, this.kind === 'skill' ? 'skills' : 'plugins', name);
  }

  async plan(t: InstallTarget): Promise<InstallPlan> {
    if (!GIT_URL_RE.test(t.id))
      throw new InstallBlockedError('INVALID_URL', 'GitHub·GitLab의 https 저장소 주소만 받을 수 있어요.');
    const repo = t.id.replace(/\.git\/?$|\/$/g, '');
    const name = t.name ?? repo.split('/').pop()!;
    const what = this.kind === 'skill' ? '스킬' : '플러그인';
    return makePlan({
      kind: this.kind,
      name,
      version: t.version ?? '',
      target: repo,
      host: this.gitHost(),
      source: { url: repo, publisher: repo.split('/')[3] ?? '', verified: false },
      needsAdmin: false,
      changes: [`${what} ${name}을(를) 하네스에 추가해요.`, '처음에는 따로 떨어진 공간에서만 돌아가요.'],
      risks: ['다른 사람이 만든 것이라 서명이 없어요.'],
      commands: [`git clone --depth 1 ${repo}.git <격리 폴더>`],
      uninstall: { commands: [] },
      verify: { cmd: '', expect: '' },
    });
  }

  async install(plan: InstallPlan, onProgress: ProgressFn, ctl: ExecControl = {}): Promise<InstallOutcome> {
    mkdirSync(this.ctx.home, { recursive: true });
    const quarantine = mkdtempSync(join(this.ctx.home, 'tmp-quarantine-'));
    const tempPaths = [quarantine];
    const repoDir = join(quarantine, 'repo');
    onProgress({ stream: 'info', data: `$ git clone --depth 1 ${plan.target}.git\n` });
    const r = await this.ctx.runner(
      { file: 'git', args: ['clone', '--depth', '1', `${plan.target}.git`, repoDir], host: this.gitHost() },
      {
        ...(ctl.timeoutMs ? { timeoutMs: ctl.timeoutMs } : {}),
        ...(ctl.signal ? { signal: ctl.signal } : {}),
        onOutput: (stream, data) => onProgress({ stream, data }),
      },
    );
    const cloned = outcomeOf(r, 'installed', '');
    if (!cloned.ok) {
      rmSync(quarantine, { recursive: true, force: true });
      return { ...cloned, tempPaths };
    }
    const v = this.kind === 'skill' ? validateSkillDir(repoDir) : validatePluginDir(repoDir);
    if (!v.ok) {
      rmSync(quarantine, { recursive: true, force: true });
      return { ok: false, status: 'failed', message: v.reason, output: '' };
    }
    const dest = this.installDir(v.id);
    if (existsSync(dest)) {
      rmSync(quarantine, { recursive: true, force: true });
      return { ok: false, status: 'failed', message: `같은 이름(${v.id})이 이미 있어요.`, output: '' };
    }
    cpSync(repoDir, dest, { recursive: true, filter: (src) => !/[\\/]\.git([\\/]|$)/.test(src) });
    rmSync(quarantine, { recursive: true, force: true });
    this.installed.set(plan.id, dest);
    return {
      ok: true,
      status: 'installed',
      message: `${v.id}을(를) 추가했어요. 처음에는 따로 떨어진 공간에서만 돌아가요.`,
      output: dest,
    };
  }

  /** 설치 폴더 이름: 검증된 id. plan에는 저장소 이름만 있으므로 설치 폴더에서 찾는다 */
  async verify(plan: InstallPlan): Promise<VerifyOutcome> {
    const dir = await this.locate(plan);
    return { ok: Boolean(dir), output: dir ?? '' };
  }

  /** E.6 설치 폴더 절대 경로 */
  async locate(plan: InstallPlan): Promise<string | undefined> {
    return this.installed.get(plan.id) ?? this.findInstalled(plan.target);
  }

  findInstalled(repo: string): string | undefined {
    const name = repo.split('/').pop()!;
    const direct = this.installDir(name);
    if (existsSync(direct)) return direct;
    return undefined;
  }

  async uninstall(record: InstalledRecord): Promise<InstallOutcome> {
    const dir =
      record.command && existsSync(record.command) ? record.command : this.findInstalled(record.target);
    if (dir) rmSync(dir, { recursive: true, force: true });
    return { ok: true, status: 'removed', message: `${record.name}을(를) 지웠어요.`, output: dir ?? '' };
  }

  uninstallPlan(record: InstalledRecord): InstallPlan {
    return makePlan({
      kind: this.kind,
      name: record.name,
      version: record.version,
      target: record.target,
      host: 'linux',
      action: 'uninstall',
      toolId: record.id,
      source: { url: record.target, publisher: '', verified: false },
      needsAdmin: false,
      changes: [`${record.name} 폴더를 지워요.`],
      risks: [],
      commands: [],
      uninstall: { commands: [] },
      verify: { cmd: '', expect: '' },
    });
  }
}
