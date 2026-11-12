import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GestureKind, InstallApi, InstallApprovalInfo, InstallOutputEvent } from '@harness-x/kernel';
import { harnessHome } from '@harness-x/kernel';
import { binNameOf, resolveExecutable } from './abs-path.js';
import {
  InstallBlockedError,
  runCommands,
  type AdapterContext,
  type ImportCandidate,
  type InstalledRecord,
  type InstallerAdapter,
  type InstallOutcome,
  type InstallTarget,
  type SearchHit,
  type SecretLike,
} from './adapter.js';
import { ChocoAdapter, ScoopAdapter, WingetAdapter } from './adapters/windows-pkg.js';
import {
  CargoAdapter,
  DockerImageAdapter,
  GoAdapter,
  NpmAdapter,
  OllamaModelAdapter,
  PythonCliAdapter,
  VscodeExtAdapter,
  WslAptAdapter,
} from './adapters/dev-tools.js';
import { McpLocalAdapter, McpRemoteAdapter, McpServerStore, mcpServersFile } from './adapters/mcp.js';
import { HarnessPluginAdapter } from './adapters/plugin.js';
import { ApiServiceAdapter, DirectDownloadAdapter } from './adapters/download.js';
import { detectTools, INSTALL_TOOLS, type DetectionTable } from './detect.js';
import {
  InstallKindSchema,
  InstallPlanSchema,
  makePlan,
  type InstallKind,
  type InstallPlan,
  type PlanAction,
} from './plan.js';
import { InstallQueue, KIND_TIMEOUT_MS } from './queue.js';
import {
  InstallLog,
  ToolRegistry,
  entryFromPlan,
  targetOf,
  type InstallLogRecord,
  type ToolEntry,
} from './registry.js';
import {
  analyzeGithubRepo,
  classifyUrl,
  recommend,
  trustLevel,
  type Candidate,
  type FetchFn,
  type UrlClass,
} from './resolve.js';
import { createRunner, detectHostPlatform, type HostPlatform, type Runner } from './runner.js';

/**
 * 설치 관리자 서비스 — 커널 InstallApi 구현.
 * AI(MCP 도구)는 search·resolve·plan만 쓴다. execute·uninstall·update·import는 사람 클릭 토큰을 거친 API로만.
 */

export interface InstallServiceOptions {
  /** 하네스 홈 (기본 harnessHome() — HARNESS_X_HOME 존중). 도구 목록은 <home>/tools/registry.json */
  home?: string;
  runner?: Runner;
  platform?: HostPlatform;
  fetch?: FetchFn;
  secrets?: SecretLike;
  /** 미리 감지한 설치 도구 표 (없으면 처음 쓸 때 감지) */
  detection?: DetectionTable;
  settings?: { chocoEnabled?: boolean };
  diskFreeMB?: AdapterContext['diskFreeMB'];
  /** 이벤트 기록 (EventLog.append 모양). 비밀번호·키는 넣지 않는다 */
  events?: { append(ev: { type: string; sessionId?: string } & Record<string, unknown>): unknown };
  timeouts?: Partial<Record<InstallKind, number>>;
  /** 어댑터 교체 (테스트) */
  adapters?: Partial<Record<InstallKind, InstallerAdapter>>;
  now?: () => Date;
}

export type JobStatus =
  | 'queued'
  | 'running'
  | 'installed'
  | 'removed'
  | 'waiting-user'
  | 'failed'
  | 'verify-failed'
  | 'cancelled'
  | 'timeout'
  | 'cleaned';

/** E.3 쉬운 말 실패 카드 (렌더는 다음 단계 — 여기서는 내용만) */
export interface FailureCard {
  title: string;
  message: string;
  /** E.4 [정리하기]가 할 일 (쉬운 말) */
  cleanup: string[];
  canCleanup: boolean;
  details: string;
}

export interface InstallJob {
  id: string;
  planId: string;
  action: PlanAction;
  status: JobStatus;
  gestureId: string;
  message?: string;
  warnings?: string[];
  failure?: FailureCard;
  toolId?: string;
}

const ACTION_GESTURE: Record<PlanAction, GestureKind> = {
  install: 'install',
  uninstall: 'uninstall',
  update: 'update',
  rollback: 'rollback',
};

const UPDATE_INTERVAL_MS = 7 * 24 * 3600 * 1000;

function notFound(what: string): Error {
  return Object.assign(new Error(`${what}을(를) 찾지 못했어요.`), { code: 'NOT_FOUND' });
}

export class InstallService implements InstallApi {
  readonly home: string;
  readonly registry: ToolRegistry;
  readonly log: InstallLog;
  readonly mcpServers: McpServerStore;
  readonly queue = new InstallQueue();
  readonly platform: HostPlatform;
  private readonly runner: Runner;
  private readonly emitter = new EventEmitter();
  private table: DetectionTable | undefined;
  private readonly plans = new Map<string, InstallPlan>();
  private readonly jobs = new Map<string, InstallJob>();
  /** T-101 2A.5 전체 정지가 기다릴 작업 끝 */
  private readonly jobDone = new Map<string, Promise<InstallJob>>();
  private readonly importCandidates = new Map<string, ImportCandidate>();
  private readonly adapters: Partial<Record<InstallKind, InstallerAdapter>> = {};
  /** 실패한 작업 → 정리 계획 (같은 승인 범위) */
  private readonly rollbacks = new Map<string, InstallPlan>();

  constructor(private readonly o: InstallServiceOptions = {}) {
    this.home = o.home ?? harnessHome();
    this.registry = new ToolRegistry(this.home);
    this.log = new InstallLog(this.home);
    this.mcpServers = new McpServerStore(mcpServersFile(this.home));
    this.platform = o.platform ?? detectHostPlatform();
    this.runner = o.runner ?? createRunner(this.platform);
    if (o.detection) this.table = o.detection;
    const ctx = {
      runner: this.runner,
      platform: this.platform,
      detection: () => this.detection(),
      home: this.home,
      mcpServers: this.mcpServers,
      ...(o.settings ? { settings: o.settings } : {}),
      ...(o.fetch ? { fetch: o.fetch as typeof fetch } : {}),
      ...(o.secrets ? { secrets: o.secrets } : {}),
      ...(o.diskFreeMB ? { diskFreeMB: o.diskFreeMB } : {}),
    };
    const all: InstallerAdapter[] = [
      new WingetAdapter(ctx),
      new ScoopAdapter(ctx),
      new ChocoAdapter(ctx),
      new NpmAdapter(ctx),
      new PythonCliAdapter(ctx),
      new CargoAdapter(ctx),
      new GoAdapter(ctx),
      new OllamaModelAdapter(ctx),
      new McpLocalAdapter(ctx),
      new McpRemoteAdapter(ctx),
      new HarnessPluginAdapter(ctx, 'harness-plugin'),
      new HarnessPluginAdapter(ctx, 'skill'),
      new VscodeExtAdapter(ctx),
      new DockerImageAdapter(ctx),
      new WslAptAdapter(ctx),
      new DirectDownloadAdapter(ctx),
      new ApiServiceAdapter(ctx),
    ];
    for (const a of all) this.adapters[a.kind] = a;
    Object.assign(this.adapters, o.adapters ?? {});
  }

  // ── 감지 ────────────────────────────────────────────────
  detection(): DetectionTable {
    if (!this.table)
      this.table = Object.fromEntries(
        INSTALL_TOOLS.map((n) => [n, { name: n, available: false }]),
      ) as DetectionTable;
    return this.table;
  }

  async detect(): Promise<DetectionTable> {
    this.table = await detectTools({ runner: this.runner, platform: this.platform });
    return this.table;
  }

  adapter(kind: InstallKind): InstallerAdapter {
    const a = this.adapters[kind];
    if (!a) throw notFound(`설치 방법(${kind})`);
    return a;
  }

  private now(): Date {
    return this.o.now?.() ?? new Date();
  }

  private emit(jobId: string, stream: InstallOutputEvent['stream'], data: string): void {
    this.emitter.emit('output', { jobId, stream, data } satisfies InstallOutputEvent);
  }

  onOutput(cb: (ev: InstallOutputEvent) => void): () => void {
    this.emitter.on('output', cb);
    return () => this.emitter.off('output', cb);
  }

  private event(type: string, data: Record<string, unknown>): void {
    try {
      this.o.events?.append({ type, sessionId: 'installer', ...data });
    } catch {
      /* 기록 실패가 설치를 막지 않는다 */
    }
  }

  // ── 찾기 (AI 노출: install.search) ───────────────────────
  async search(query: string, kind?: string): Promise<{ query: string; candidates: Candidate[] }> {
    const q = query.trim();
    const only = kind ? InstallKindSchema.parse(kind) : undefined;
    const cands: Candidate[] = [];
    const isAvail = async (k: InstallKind) =>
      (!only || only === k) && (await this.adapter(k).available()).available;
    if (await isAvail('winget')) {
      const hits: SearchHit[] = (await this.adapter('winget').search?.(q)) ?? [];
      for (const h of hits.slice(0, 5))
        cands.push({
          kind: 'winget',
          target: { id: h.id, name: h.name, ...(h.version ? { version: h.version } : {}) },
          label: `${h.name} (Windows 앱 저장소)`,
          source: `winget:${h.id}`,
          trust: trustLevel({ kind: 'winget' }),
        });
    }
    const simple = /^[a-z0-9][\w.-]*$/i.test(q);
    const guess = (k: InstallKind, label: string) =>
      cands.push({ kind: k, target: { id: q }, label, source: k, trust: trustLevel({ kind: k }) });
    if (simple && (await isAvail('npm-cli'))) guess('npm-cli', `npm 명령줄 도구 ${q}`);
    if (simple && (await isAvail('python-cli'))) guess('python-cli', `Python 명령줄 도구 ${q}`);
    // B.5 cargo / go는 설치 도구가 있을 때만 후보
    if (simple && (await isAvail('cargo'))) guess('cargo', `Rust 도구 ${q}`);
    if (/^[a-z0-9.-]+\.[a-z]+(\/[\w.-]+)+$/.test(q) && (await isAvail('go'))) guess('go', `Go 도구 ${q}`);
    return { query: q, candidates: recommend(cands).ranked };
  }

  // ── 주소로 설치 (AI 노출: install.resolve) ───────────────
  async resolve(url: string): Promise<{
    input: string;
    classification: UrlClass;
    candidates: Candidate[];
    recommended?: Candidate;
    reason?: string;
    failure?: string;
  }> {
    const c = classifyUrl(url);
    let cands: Candidate[] = [];
    try {
      if (c.type === 'github-repo' || c.type === 'gist-skill') {
        if (c.type === 'github-repo') {
          if (!this.o.fetch)
            throw new InstallBlockedError('NO_NETWORK', '저장소를 살펴볼 수 없어요(인터넷 조회 꺼짐).');
          cands = (await analyzeGithubRepo(this.o.fetch, c.owner!, c.repo!)).candidates;
        } else cands = [{ kind: 'skill', target: { id: c.url! }, label: '스킬(gist)', source: c.url! }];
      } else if (c.kind && c.id) {
        cands = [
          {
            kind: c.kind,
            target: { id: c.id, ...(c.version ? { version: c.version } : {}) },
            label: c.type,
            source: c.url ?? c.id,
            trust: trustLevel({ kind: c.kind, ...(c.type === 'ollama' ? { verifiedPublisher: true } : {}) }),
          },
        ];
      }
    } catch (err) {
      return { input: url, classification: c, candidates: [], failure: (err as Error).message };
    }
    cands = cands.map((x) => ({ ...x, trust: x.trust ?? trustLevel({ kind: x.kind }) }));
    if (!cands.length)
      return {
        input: url,
        classification: c,
        candidates: [],
        failure: '이 주소에서 설치 방법을 찾지 못했어요.',
      };
    const r = recommend(cands);
    return {
      input: url,
      classification: c,
      candidates: r.ranked,
      ...(r.recommended ? { recommended: r.recommended } : {}),
      ...(r.reason ? { reason: r.reason } : {}),
    };
  }

  // ── 계획 (AI 노출: install.plan) ─────────────────────────
  async plan(
    req: Record<string, unknown>,
  ): Promise<
    InstallPlan | { unavailable: true; kind: InstallKind; missing: string[]; bootstrap?: InstallPlan }
  > {
    const kind = InstallKindSchema.parse(req.kind);
    const t = (req.target ?? {}) as Partial<InstallTarget>;
    if (typeof t.id !== 'string' || !t.id)
      throw new InstallBlockedError('INVALID_TARGET', '무엇을 설치할지 알려 주세요.');
    const a = this.adapter(kind);
    const av = await a.available();
    if (!av.available) {
      if (av.bootstrap) this.plans.set(av.bootstrap.id, av.bootstrap);
      return {
        unavailable: true,
        kind,
        missing: av.missing,
        ...(av.bootstrap ? { bootstrap: av.bootstrap } : {}),
      };
    }
    const plan = await a.plan({
      id: t.id,
      ...(typeof t.version === 'string' ? { version: t.version } : {}),
      ...(typeof t.name === 'string' ? { name: t.name } : {}),
      ...(t.options && typeof t.options === 'object' ? { options: t.options } : {}),
    });
    this.plans.set(plan.id, plan);
    this.event('install_planned', { planId: plan.id, kind: plan.kind, target: plan.target });
    return plan;
  }

  getPlan(planId: string): InstallPlan | undefined {
    return this.plans.get(planId);
  }

  /** 테스트·내부용: 계획을 직접 등록 */
  addPlan(plan: InstallPlan): InstallPlan {
    const p = InstallPlanSchema.parse(plan);
    this.plans.set(p.id, p);
    return p;
  }

  gestureKindFor(planId: string): GestureKind | undefined {
    const p = this.plans.get(planId);
    return p ? ACTION_GESTURE[p.action] : undefined;
  }

  job(jobId: string): InstallJob | undefined {
    return this.jobs.get(jobId);
  }

  // ── 실행 (사람 클릭 토큰을 거친 API만) ───────────────────
  execute(planId: string, approval: InstallApprovalInfo): InstallJob & { done: Promise<InstallJob> } {
    const plan = this.plans.get(planId);
    if (!plan) throw notFound('계획');
    // 같은 계획은 한 번만 실행 (토큰 1회용과 별개로 이중 실행 방지)
    this.plans.delete(planId);
    const job: InstallJob = {
      id: `job_${randomUUID()}`,
      planId,
      action: plan.action,
      status: 'queued',
      gestureId: approval.gestureId,
      ...(plan.toolId ? { toolId: plan.toolId } : {}),
    };
    this.jobs.set(job.id, job);
    const timeoutMs = this.o.timeouts?.[plan.kind] ?? KIND_TIMEOUT_MS[plan.kind];
    const q = this.queue.enqueue(job.id, (signal) => this.runJob(job, plan, signal, timeoutMs), timeoutMs);
    const done = q.done.then(
      () => job,
      () => {
        if (job.status === 'queued') job.status = 'cancelled';
        else if (job.status === 'running') {
          job.status = 'failed';
          job.message = '설치 중에 문제가 생겼어요.';
        }
        return job;
      },
    );
    this.jobDone.set(job.id, done);
    void done.finally(() => this.jobDone.delete(job.id));
    return Object.assign({ ...job }, { done }) as InstallJob & { done: Promise<InstallJob> };
  }

  private async runJob(
    job: InstallJob,
    plan: InstallPlan,
    signal: AbortSignal,
    timeoutMs: number,
  ): Promise<void> {
    job.status = 'running';
    const a = this.adapter(plan.kind);
    const progress = (p: { stream: InstallOutputEvent['stream']; data: string }) =>
      this.emit(job.id, p.stream, p.data);
    this.emit(job.id, 'info', `[${plan.action}] ${plan.name}\n`);
    let outcome: InstallOutcome;
    try {
      if (plan.action === 'uninstall') {
        const entry = plan.toolId ? this.registry.get(plan.toolId) : undefined;
        const record = entry ? recordOf(entry) : recordFromPlan(plan);
        outcome = await a.uninstall(record, progress, { signal, timeoutMs });
      } else outcome = await a.install(plan, progress, { signal, timeoutMs });
    } catch (err) {
      outcome = {
        ok: false,
        status: 'failed',
        message: err instanceof InstallBlockedError ? err.message : '설치 중에 문제가 생겼어요.',
        output: err instanceof Error ? err.message : String(err),
      };
    }
    // 큐가 시간 제한으로 abort했으면 timeout
    if (
      outcome.status === 'cancelled' &&
      signal.reason instanceof Error &&
      signal.reason.name === 'TimeoutAbort'
    )
      outcome = { ...outcome, status: 'timeout', message: '시간이 너무 오래 걸려서 멈췄어요.' };
    // E.2 취소·시간 초과·실패 시 임시 파일 정리
    for (const p of outcome.tempPaths ?? []) rmSync(p, { recursive: true, force: true });
    if (outcome.warnings?.length) job.warnings = outcome.warnings;
    job.message = outcome.message;

    if (outcome.status === 'needs-user') {
      job.status = 'waiting-user';
      this.pendingUser.set(job.id, plan);
      this.record(job, plan, outcome);
      return;
    }
    if (!outcome.ok) {
      job.status =
        outcome.status === 'cancelled' ? 'cancelled' : outcome.status === 'timeout' ? 'timeout' : 'failed';
      if (plan.action === 'install' || plan.action === 'update')
        this.offerCleanup(job, plan, outcome.message, outcome.output);
      this.record(job, plan, outcome);
      return;
    }
    if (plan.action === 'uninstall') {
      await this.finishUninstall(job, plan, outcome);
      return;
    }
    await this.finishInstall(job, plan, outcome);
  }

  private readonly pendingUser = new Map<string, InstallPlan>();

  /** E.3 검증 → E.6 절대 경로 → F.2 등록 → E.5 기록 */
  private async finishInstall(job: InstallJob, plan: InstallPlan, outcome: InstallOutcome): Promise<void> {
    const a = this.adapter(plan.kind);
    const v = await a.verify(plan);
    if (!v.ok) {
      job.status = 'verify-failed';
      this.offerCleanup(job, plan, '설치는 끝났지만 제대로 동작하는지 확인하지 못했어요.', v.output);
      this.record(job, plan, {
        ...outcome,
        ok: false,
        status: 'failed',
        message: job.failure!.message,
        output: `${outcome.output}\n${v.output}`,
      });
      return;
    }
    let command: string | undefined;
    if (a.locate) command = await a.locate(plan);
    else {
      const bin = binNameOf(plan);
      if (bin) command = await resolveExecutable(this.runner, plan.host, bin);
    }
    const entry = entryFromPlan(plan, {
      ...(command ? { command } : {}),
      ...(v.version ? { version: v.version } : {}),
      now: this.now(),
    });
    const prev = this.registry.get(entry.id);
    this.registry.upsert(prev && plan.action === 'update' ? { ...entry, origin: prev.origin } : entry);
    job.status = 'installed';
    job.toolId = entry.id;
    this.record(job, plan, outcome);
    this.event('tool_registered', { toolId: entry.id, kind: entry.kind });
  }

  private async finishUninstall(job: InstallJob, plan: InstallPlan, outcome: InstallOutcome): Promise<void> {
    const id = plan.toolId ?? `${plan.kind}:${plan.target}`;
    this.registry.remove(id);
    job.status = 'removed';
    job.toolId = id;
    this.record(job, plan, outcome);
    this.event('tool_unregistered', { toolId: id });
  }

  /** E.3·E.4 실패 카드 + 정리 계획(같은 승인 범위) */
  private offerCleanup(job: InstallJob, plan: InstallPlan, message: string, details: string): void {
    const cmds = plan.uninstall.commands;
    const cleanup = cmds.length
      ? [`설치하다 남은 ${plan.name}을(를) 지워요.`, '받은 임시 파일을 지워요.']
      : ['받은 임시 파일을 지워요.'];
    const { id: _id, ...rest } = plan;
    void _id;
    const rb = makePlan({
      ...rest,
      action: 'rollback',
      changes: cleanup,
      risks: [],
      commands: cmds,
      uninstall: { commands: [] },
      verify: { cmd: '', expect: '' },
    });
    this.rollbacks.set(job.id, rb);
    job.failure = {
      title: '설치가 끝나지 않았어요',
      message,
      cleanup,
      canCleanup: true,
      details: details.slice(-2000),
    };
  }

  /** E.4 [정리하기] — 실패한 작업의 승인 범위로 1회만 실행 (새 토큰 불필요) */
  async cleanup(jobId: string): Promise<InstallJob> {
    const job = this.jobs.get(jobId);
    const rb = this.rollbacks.get(jobId);
    if (!job || !rb) throw notFound('정리할 작업');
    this.rollbacks.delete(jobId);
    let outcome: InstallOutcome;
    if (rb.commands.length) {
      outcome = await runCommands(
        { runner: this.runner, platform: this.platform, detection: () => this.detection() },
        rb.host,
        rb.commands,
        (p) => this.emit(jobId, p.stream, p.data),
        {},
        { status: 'removed', message: '정리했어요.' },
      );
    } else outcome = { ok: true, status: 'removed', message: '정리했어요.', output: '' };
    job.status = 'cleaned';
    if (job.failure) job.failure.canCleanup = false;
    this.record(job, rb, outcome);
    return job;
  }

  /** 사용자가 직접 진행한 단계(sudo·설치 화면·키 넣기)가 끝났다고 알림 → 검증·등록 */
  async confirmUserStep(jobId: string): Promise<InstallJob> {
    const job = this.jobs.get(jobId);
    const plan = this.pendingUser.get(jobId);
    if (!job || !plan) throw notFound('기다리는 작업');
    this.pendingUser.delete(jobId);
    const done: InstallOutcome = {
      ok: true,
      status: 'installed',
      message: '직접 진행을 마쳤어요.',
      output: '',
    };
    if (plan.action === 'uninstall') await this.finishUninstall(job, plan, { ...done, status: 'removed' });
    else await this.finishInstall(job, plan, done);
    return job;
  }

  /**
   * T-101 2A.5 전체 정지: 설치를 중단 가능한 지점에서 멈추고 정리한다.
   * - 대기 중인 작업은 시작하지 않는다(cancelled)
   * - 실행 중인 작업은 실행기에 abort → 프로세스 종료 + 임시 파일 정리(runJob)
   * - 설치 명령이 이미 끝나 확인·등록 중이면 끝까지 마친다(반쯤 등록된 도구를 남기지 않음)
   * 모든 작업이 끝난 뒤 그 작업들을 돌려준다.
   */
  async stopAll(): Promise<InstallJob[]> {
    const ids = [...this.queue.pending, ...(this.queue.running ? [this.queue.running] : [])];
    const waits = ids.map((id) => this.jobDone.get(id)).filter((d): d is Promise<InstallJob> => !!d);
    for (const id of ids) this.cancel(id);
    const jobs = await Promise.all(waits);
    return jobs.map((j) => ({ ...j }));
  }

  cancel(jobId: string): boolean {
    const ok = this.queue.cancel(jobId);
    const job = this.jobs.get(jobId);
    if (ok && job && job.status === 'queued') job.status = 'cancelled';
    return ok;
  }

  private record(job: InstallJob, plan: InstallPlan, outcome: InstallOutcome): InstallLogRecord {
    const rec = this.log.append({
      action: plan.action,
      plan,
      gestureId: job.gestureId,
      result: { ok: outcome.ok, status: job.status, message: outcome.message },
      output: outcome.output,
      jobId: job.id,
      ...(job.toolId ? { toolId: job.toolId } : {}),
    });
    this.event('install_result', { jobId: job.id, action: plan.action, status: job.status, kind: plan.kind });
    return rec;
  }

  // ── E.7 제거 계획 ────────────────────────────────────────
  uninstallPlan(toolId: string): InstallPlan {
    const entry = this.registry.get(toolId);
    if (!entry) throw notFound('도구');
    const a = this.adapter(entry.kind);
    const record = recordOf(entry);
    const plan = a.uninstallPlan
      ? a.uninstallPlan(record)
      : makePlan({
          kind: entry.kind,
          name: entry.name,
          version: entry.version,
          target: record.target,
          action: 'uninstall',
          toolId,
          source: entry.source,
          needsAdmin: false,
          changes: [`${entry.name}을(를) 지워요.`],
          risks: [],
          commands: [],
          uninstall: { commands: [] },
          verify: { cmd: '', expect: '' },
        });
    this.plans.set(plan.id, plan);
    return plan;
  }

  // ── E.8 업데이트 확인 (주 1회, 조회만 — 자동 업데이트 없음) ──
  private updateStampFile(): string {
    return join(this.home, 'tools', 'update-check.json');
  }

  async checkUpdates(
    opts: { force?: boolean } = {},
  ): Promise<{ checkedAt: string; skipped: boolean; updates: InstallPlan[] }> {
    const f = this.updateStampFile();
    const now = this.now();
    if (!opts.force && existsSync(f)) {
      try {
        const last = new Date((JSON.parse(readFileSync(f, 'utf8')) as { checkedAt: string }).checkedAt);
        if (now.getTime() - last.getTime() < UPDATE_INTERVAL_MS)
          return { checkedAt: last.toISOString(), skipped: true, updates: [] };
      } catch {
        /* 깨진 기록은 무시 */
      }
    }
    const updates: InstallPlan[] = [];
    for (const entry of this.registry.list()) {
      const a = this.adapters[entry.kind];
      if (!a?.latestVersion) continue;
      const record = recordOf(entry);
      let latest: string | undefined;
      try {
        latest = await a.latestVersion(record);
      } catch {
        continue;
      }
      if (!latest || latest === entry.version) continue;
      try {
        const p = await a.plan({ id: record.target, version: latest, name: entry.name });
        const up = InstallPlanSchema.parse({
          ...p,
          action: 'update',
          toolId: entry.id,
          changes: [
            `${entry.name}을(를) ${entry.version || '현재 버전'}에서 ${latest}(으)로 바꿔요.`,
            ...p.changes.slice(1),
          ],
        });
        this.plans.set(up.id, up);
        updates.push(up);
      } catch {
        /* 계획을 못 만들면 건너뜀 */
      }
    }
    mkdirSync(join(this.home, 'tools'), { recursive: true });
    writeFileSync(f, JSON.stringify({ checkedAt: now.toISOString() }) + '\n');
    return { checkedAt: now.toISOString(), skipped: false, updates };
  }

  // ── E.9 이미 있던 도구 가져오기 (사용자 확인 후) ─────────
  async importScan(): Promise<{ candidates: (ImportCandidate & { id: string })[] }> {
    const out: (ImportCandidate & { id: string })[] = [];
    const known = new Set(this.registry.list().map((t) => t.id));
    for (const kind of ['winget', 'npm-cli', 'ollama-model', 'vscode-ext'] as const) {
      const a = this.adapters[kind];
      const av = a ? await a.available() : undefined;
      if (!a?.listInstalled || !av?.available) continue;
      for (const c of await a.listInstalled()) {
        const id = `${c.kind}:${c.target}`;
        if (known.has(id)) continue;
        this.importCandidates.set(id, c);
        out.push({ ...c, id });
      }
    }
    return { candidates: out };
  }

  importTools(ids: string[], approval: InstallApprovalInfo): { imported: ToolEntry[] } {
    const imported: ToolEntry[] = [];
    for (const id of ids) {
      const c = this.importCandidates.get(id);
      if (!c) continue;
      const plan = makePlan({
        kind: c.kind,
        name: c.name,
        version: c.version,
        target: c.target,
        source: { url: '', publisher: '', verified: false },
        needsAdmin: false,
        changes: ['이미 있던 도구를 목록에 넣어요.'],
        risks: [],
        commands: [],
        uninstall: { commands: [] },
        verify: { cmd: '', expect: '' },
      });
      const entry = this.registry.upsert(
        entryFromPlan(plan, { origin: 'imported', now: this.now(), purpose: `${c.name} — 이미 있던 도구` }),
      );
      this.importCandidates.delete(id);
      imported.push(entry);
      this.log.append({
        action: 'import',
        plan,
        gestureId: approval.gestureId,
        result: { ok: true, status: 'imported', message: '이미 있던 도구를 목록에 넣었어요.' },
        toolId: entry.id,
      });
    }
    return { imported };
  }

  tools(): { tools: ToolEntry[] } {
    return { tools: this.registry.list() };
  }

  history(): { records: InstallLogRecord[] } {
    return { records: this.log.read() };
  }
}

export function recordOf(entry: ToolEntry): InstalledRecord {
  return {
    id: entry.id,
    kind: entry.kind,
    name: entry.name,
    version: entry.version,
    target: targetOf(entry),
    ...(entry.command ? { command: entry.command } : {}),
  };
}

function recordFromPlan(plan: InstallPlan): InstalledRecord {
  return {
    id: plan.toolId ?? `${plan.kind}:${plan.target}`,
    kind: plan.kind,
    name: plan.name,
    version: plan.version,
    target: plan.target,
  };
}
