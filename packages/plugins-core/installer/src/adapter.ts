import { kindAvailability, type DetectionTable, type KindAvailability } from './detect.js';
import {
  formatCommand,
  makePlan,
  parseCommand,
  type CommandHost,
  type InstallKind,
  type InstallPlan,
} from './plan.js';
import type { HostPlatform, Runner, RunResult } from './runner.js';

/** makePlan 입력 (기본값이 있는 필드는 생략 가능) */
export type PlanFields = Parameters<typeof makePlan>[0];

/** 설치할 대상 (검색어·패키지 id·주소 등) */
export interface InstallTarget {
  /** 패키지 식별자 (winget id, npm 패키지 이름, 모델 이름, 주소 …) */
  id: string;
  version?: string;
  /** 표시 이름 (없으면 id) */
  name?: string;
  /** 종류별 추가 옵션 (예: npm ignoreScripts, direct-download sha256) */
  options?: Record<string, unknown>;
}

export interface InstallProgress {
  stream: 'stdout' | 'stderr' | 'info';
  data: string;
}
export type ProgressFn = (p: InstallProgress) => void;

export interface ExecControl {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export type OutcomeStatus = 'installed' | 'removed' | 'needs-user' | 'failed' | 'cancelled' | 'timeout';

export interface InstallOutcome {
  ok: boolean;
  status: OutcomeStatus;
  /** 쉬운 말 요약 */
  message: string;
  /** 출력 요약 (마지막 부분) */
  output: string;
  /** 실패 시 정리해야 할 임시 파일·폴더 */
  tempPaths?: string[];
  /** 빨간 경고 (예: 서명 없음) */
  warnings?: string[];
}

export interface VerifyOutcome {
  ok: boolean;
  output: string;
  version?: string;
}

/** 도구 목록에 들어 있는 설치 기록 (제거·업데이트에 쓰는 최소 정보) */
export interface InstalledRecord {
  id: string;
  kind: InstallKind;
  name: string;
  version: string;
  /** 패키지 식별자 (id = `<kind>:<target>`) */
  target: string;
  /** 실행 파일 절대 경로 (없을 수 있음) */
  command?: string;
}

export interface SearchHit {
  kind: InstallKind;
  id: string;
  name: string;
  version?: string;
  publisher?: string;
  description?: string;
}

export interface ImportCandidate {
  kind: InstallKind;
  target: string;
  name: string;
  version: string;
}

/** P2-A.4 설치 어댑터 */
export interface InstallerAdapter {
  readonly kind: InstallKind;
  available(): KindAvailability | Promise<KindAvailability>;
  plan(target: InstallTarget): Promise<InstallPlan>;
  install(plan: InstallPlan, onProgress: ProgressFn, ctl?: ExecControl): Promise<InstallOutcome>;
  verify(plan: InstallPlan): Promise<VerifyOutcome>;
  uninstall(record: InstalledRecord, onProgress?: ProgressFn, ctl?: ExecControl): Promise<InstallOutcome>;
  /** 제거 계획 (E.7: 카드 → 승인 → uninstall) */
  uninstallPlan?(record: InstalledRecord): InstallPlan;
  /** 설치 결과의 실행 파일 절대 경로 (E.6) */
  locate?(plan: InstallPlan): Promise<string | undefined>;
  search?(query: string): Promise<SearchHit[]>;
  /** 최신 버전 조회 (E.8, 네트워크 조회만) */
  latestVersion?(record: InstalledRecord): Promise<string | undefined>;
  /** 이미 설치된 것 목록 (E.9) */
  listInstalled?(): Promise<ImportCandidate[]>;
}

/** 어댑터 공용 환경 */
export interface AdapterContext {
  runner: Runner;
  platform: HostPlatform;
  /** 설치 도구 감지 결과 (A.5) */
  detection: () => DetectionTable;
  settings?: { chocoEnabled?: boolean };
  /** 읽기 전용 네트워크 조회 (테스트는 모킹) */
  fetch?: typeof fetch;
  /** 하네스 홈 (~/.harness-x) */
  home?: string;
  /** 키체인 (kernel SecretStore와 같은 모양) */
  secrets?: SecretLike;
  /** 디스크 여유 공간(MB) */
  diskFreeMB?: (host: CommandHost) => Promise<number | undefined>;
}

export interface SecretLike {
  get(account: string): string | null;
  set(account: string, value: string): void;
  delete(account: string): boolean;
}

/** 설치를 시작하기 전에 막는 경우 (쉬운 말 메시지) */
export class InstallBlockedError extends Error {
  readonly status = 400;
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'InstallBlockedError';
  }
}

export function toolId(kind: InstallKind, target: string): string {
  return `${kind}:${target}`;
}

const tail = (s: string, n = 2000) => (s.length > n ? s.slice(-n) : s);

/** 결과 → 상태 */
export function outcomeOf(r: RunResult, okStatus: OutcomeStatus, okMessage: string): InstallOutcome {
  const output = tail(`${r.stdout}${r.stderr ? `\n${r.stderr}` : ''}`.trim());
  if (r.cancelled) return { ok: false, status: 'cancelled', message: '취소했어요.', output };
  if (r.timedOut)
    return { ok: false, status: 'timeout', message: '시간이 너무 오래 걸려서 멈췄어요.', output };
  if (r.code !== 0)
    return {
      ok: false,
      status: 'failed',
      message: r.error ? '명령을 실행하지 못했어요.' : '설치 도구가 실패를 알렸어요.',
      output: output || (r.error ?? ''),
    };
  return { ok: true, status: okStatus, message: okMessage, output };
}

/** 원문 명령 목록을 차례로 실행 (첫 실패에서 멈춤) */
export async function runCommands(
  ctx: AdapterContext,
  host: CommandHost,
  commands: readonly string[],
  onProgress: ProgressFn | undefined,
  ctl: ExecControl = {},
  ok: { status: OutcomeStatus; message: string } = { status: 'installed', message: '설치했어요.' },
): Promise<InstallOutcome> {
  let last: InstallOutcome = { ok: true, status: ok.status, message: ok.message, output: '' };
  for (const line of commands) {
    const [file, ...args] = parseCommand(line);
    if (!file) continue;
    onProgress?.({ stream: 'info', data: `$ ${line}\n` });
    const r = await ctx.runner(
      { file, args, host },
      {
        ...(ctl.timeoutMs ? { timeoutMs: ctl.timeoutMs } : {}),
        ...(ctl.signal ? { signal: ctl.signal } : {}),
        onOutput: (stream, data) => onProgress?.({ stream, data }),
      },
    );
    last = outcomeOf(r, ok.status, ok.message);
    if (!last.ok) return last;
  }
  return last;
}

/**
 * 명령형 어댑터 공통 구현: install = plan.commands 실행, verify = plan.verify.cmd 실행 후 expect 포함 확인,
 * uninstall = uninstallCommands(record) 실행.
 */
export abstract class CommandAdapter implements InstallerAdapter {
  abstract readonly kind: InstallKind;
  /** 이 종류의 명령을 실행할 곳 (기본: 감지된 설치 도구의 위치, 없으면 windows) */
  protected defaultHost: CommandHost = 'windows';

  constructor(protected readonly ctx: AdapterContext) {}

  available(): KindAvailability {
    return kindAvailability(this.kind, this.ctx.detection(), this.ctx.settings ?? {});
  }

  /** 감지 결과 기준 실행 위치 */
  protected host(): CommandHost {
    const a = this.available();
    return a.available && a.tool?.host ? a.tool.host : this.defaultHost;
  }

  abstract plan(target: InstallTarget): Promise<InstallPlan>;
  abstract uninstallCommands(record: InstalledRecord): string[];

  install(plan: InstallPlan, onProgress: ProgressFn, ctl?: ExecControl): Promise<InstallOutcome> {
    return runCommands(this.ctx, plan.host, plan.commands, onProgress, ctl);
  }

  async verify(plan: InstallPlan): Promise<VerifyOutcome> {
    if (!plan.verify.cmd) return { ok: true, output: '' };
    const [file, ...args] = parseCommand(plan.verify.cmd);
    const r = await this.ctx.runner({ file: file!, args, host: plan.host }, { timeoutMs: 60_000 });
    const output = `${r.stdout}\n${r.stderr}`.trim();
    const ok = r.code === 0 && (!plan.verify.expect || output.includes(plan.verify.expect));
    return { ok, output };
  }

  uninstall(record: InstalledRecord, onProgress?: ProgressFn, ctl?: ExecControl): Promise<InstallOutcome> {
    return runCommands(this.ctx, this.host(), this.uninstallCommands(record), onProgress, ctl, {
      status: 'removed',
      message: '지웠어요.',
    });
  }

  uninstallPlan(record: InstalledRecord): InstallPlan {
    return makePlan({
      kind: this.kind,
      name: record.name,
      version: record.version,
      target: record.target,
      host: this.host(),
      action: 'uninstall',
      toolId: record.id,
      source: { url: '', publisher: '', verified: true },
      needsAdmin: false,
      changes: [`${record.name}을(를) 컴퓨터에서 지워요.`, '도구 목록에서도 빠져요.'],
      risks: ['이 도구를 쓰던 작업은 더 이상 이 도구를 쓸 수 없어요.'],
      commands: this.uninstallCommands(record),
      uninstall: { commands: [] },
      verify: { cmd: '', expect: '' },
    });
  }

  /** 하위 클래스 공용: 기본값 채운 계획 */
  protected mk(p: Omit<PlanFields, 'kind'>): InstallPlan {
    return makePlan({ kind: this.kind, ...p });
  }

  protected fmt(argv: string[]): string {
    return formatCommand(argv);
  }
}
