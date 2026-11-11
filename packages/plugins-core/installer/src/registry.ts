import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { maskSecrets } from '@harness-x/kernel';
import { InstallKindSchema, LicenseSchema, PricingSchema, SourceSchema, type InstallPlan } from './plan.js';

/**
 * P2-F 도구 목록(레지스트리) — <home>/tools/registry.json (home 기본 ~/.harness-x, 주입 가능)
 * P2-E.5 설치 기록 — <home>/tools/installs.jsonl (1건 = 1줄)
 */

export function toolsDir(home: string): string {
  return join(home, 'tools');
}
export function registryFile(home: string): string {
  return join(toolsDir(home), 'registry.json');
}
export function installsLogFile(home: string): string {
  return join(toolsDir(home), 'installs.jsonl');
}

/** 절대 경로 (리눅스 /…, Windows C:\… 또는 \\서버\…) 또는 빈 문자열(실행 파일 없는 종류) */
const AbsPathSchema = z
  .string()
  .refine((p) => p === '' || p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('\\\\'), {
    message: 'command는 절대 경로여야 합니다',
  });

/** P2-F.1 도구 목록 항목 */
export const ToolEntrySchema = z
  .object({
    /** `<종류>:<패키지 식별자>` */
    id: z.string().min(3),
    name: z.string().min(1),
    kind: InstallKindSchema,
    version: z.string(),
    /** 실행 파일 절대 경로 (E.6: PATH가 갱신되지 않아도 이 경로로 실행) */
    command: AbsPathSchema,
    pricing: PricingSchema,
    license: LicenseSchema,
    source: SourceSchema,
    installedAt: z.string(),
    origin: z.enum(['installed', 'imported']),
    /** 쉬운 말 용도 */
    purpose: z.string(),
    capabilities: z.array(z.string()),
    /** 예시 명령 1~3개 */
    howToUse: z.array(z.string()).min(1).max(3),
  })
  .strict();
export type ToolEntry = z.infer<typeof ToolEntrySchema>;

export const RegistryFileSchema = z.object({
  version: z.literal(1),
  /** 바뀔 때마다 1씩 증가 (F.5 핫리로드 판단용) */
  revision: z.number().int().nonnegative(),
  tools: z.array(ToolEntrySchema),
});
export type RegistryFile = z.infer<typeof RegistryFileSchema>;

export function targetOf(entry: Pick<ToolEntry, 'id' | 'kind'>): string {
  return entry.id.startsWith(`${entry.kind}:`) ? entry.id.slice(entry.kind.length + 1) : entry.id;
}

export class ToolRegistry {
  readonly file: string;
  private readonly listeners = new Set<(r: RegistryFile) => void>();

  constructor(readonly home: string) {
    this.file = registryFile(home);
  }

  read(): RegistryFile {
    if (!existsSync(this.file)) return { version: 1, revision: 0, tools: [] };
    try {
      const r = RegistryFileSchema.safeParse(JSON.parse(readFileSync(this.file, 'utf8')));
      return r.success ? r.data : { version: 1, revision: 0, tools: [] };
    } catch {
      return { version: 1, revision: 0, tools: [] };
    }
  }

  list(): ToolEntry[] {
    return this.read().tools;
  }

  get(id: string): ToolEntry | undefined {
    return this.list().find((t) => t.id === id);
  }

  revision(): number {
    return this.read().revision;
  }

  upsert(entry: ToolEntry): ToolEntry {
    const e = ToolEntrySchema.parse(entry);
    const cur = this.read();
    this.write({ ...cur, revision: cur.revision + 1, tools: [...cur.tools.filter((t) => t.id !== e.id), e] });
    return e;
  }

  remove(id: string): boolean {
    const cur = this.read();
    const tools = cur.tools.filter((t) => t.id !== id);
    if (tools.length === cur.tools.length) return false;
    this.write({ ...cur, revision: cur.revision + 1, tools });
    return true;
  }

  onChange(fn: (r: RegistryFile) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private write(r: RegistryFile): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(r, null, 2) + '\n');
    renameSync(tmp, this.file);
    for (const fn of this.listeners) fn(r);
  }
}

/** 종류별 기본 용도·태그·사용 예 (계획에서 도구 목록 항목 만들기) */
const KIND_DEFAULTS: Record<string, { purpose: string; caps: string[] }> = {
  winget: { purpose: 'Windows 프로그램', caps: ['cli', 'windows'] },
  scoop: { purpose: 'Windows 프로그램', caps: ['cli', 'windows'] },
  choco: { purpose: 'Windows 프로그램', caps: ['cli', 'windows'] },
  'npm-cli': { purpose: '명령줄 도구', caps: ['cli', 'node'] },
  'python-cli': { purpose: '명령줄 도구', caps: ['cli', 'python'] },
  cargo: { purpose: '명령줄 도구', caps: ['cli', 'rust'] },
  go: { purpose: '명령줄 도구', caps: ['cli', 'go'] },
  'ollama-model': { purpose: '내 컴퓨터에서 돌아가는 AI 모델', caps: ['llm', 'local'] },
  'mcp-local': { purpose: 'AI가 쓰는 도구 연결', caps: ['mcp'] },
  'mcp-remote': { purpose: 'AI가 쓰는 원격 도구 연결', caps: ['mcp', 'remote'] },
  'harness-plugin': { purpose: '하네스 기능 추가', caps: ['plugin'] },
  skill: { purpose: 'AI 작업 방법 설명', caps: ['skill'] },
  'vscode-ext': { purpose: 'VS Code 기능 추가', caps: ['vscode'] },
  'docker-image': { purpose: '컨테이너 이미지', caps: ['docker'] },
  'wsl-apt': { purpose: '리눅스 프로그램', caps: ['cli', 'linux'] },
  'direct-download': { purpose: 'Windows 프로그램', caps: ['windows'] },
  'api-service': { purpose: '인터넷 서비스(키로 사용)', caps: ['api'] },
};

export function howToUseFor(plan: InstallPlan, command: string): string[] {
  const q = (p: string) => (/\s/.test(p) ? `"${p}"` : p);
  switch (plan.kind) {
    case 'ollama-model':
      return [`ollama run ${plan.target}`];
    case 'docker-image':
      return [`docker run --rm ${plan.target}`];
    case 'vscode-ext':
      return ['VS Code를 다시 열면 바로 쓸 수 있어요.'];
    case 'mcp-local':
    case 'mcp-remote':
      return ['AI 도구 목록에 자동으로 나타나요.'];
    case 'api-service':
      return ['저장한 키로 서비스를 불러요.'];
    case 'harness-plugin':
    case 'skill':
      return ['다음 작업부터 자동으로 쓸 수 있어요.'];
    default:
      return command ? [`${q(command)} --help`, `${q(command)} --version`] : [`${plan.name} --help`];
  }
}

export function entryFromPlan(
  plan: InstallPlan,
  opts: {
    command?: string;
    version?: string;
    origin?: 'installed' | 'imported';
    now?: Date;
    purpose?: string;
  } = {},
): ToolEntry {
  const d = KIND_DEFAULTS[plan.kind] ?? { purpose: plan.name, caps: [] };
  const command = opts.command ?? '';
  return ToolEntrySchema.parse({
    id: `${plan.kind}:${plan.target}`,
    name: plan.name,
    kind: plan.kind,
    version: opts.version ?? plan.version,
    command,
    pricing: plan.pricing,
    license: plan.license,
    source: plan.source,
    installedAt: (opts.now ?? new Date()).toISOString(),
    origin: opts.origin ?? 'installed',
    purpose: opts.purpose ?? `${plan.name} — ${d.purpose}`,
    capabilities: d.caps,
    howToUse: howToUseFor(plan, command),
  });
}

// ── E.5 installs.jsonl ───────────────────────────────────────
export interface InstallLogRecord {
  ts: string;
  action: InstallPlan['action'] | 'import';
  /** 계획 원문 */
  plan: InstallPlan | null;
  /** 승인에 쓴 클릭 토큰 id (토큰 값은 남기지 않는다) */
  gestureId: string;
  result: { ok: boolean; status: string; message: string };
  /** 출력 요약 (끝 2000자, 비밀 패턴 가림) */
  output: string;
  toolId?: string;
  jobId?: string;
}

export class InstallLog {
  readonly file: string;
  constructor(home: string) {
    this.file = installsLogFile(home);
  }
  append(rec: Omit<InstallLogRecord, 'ts' | 'output'> & { ts?: string; output?: string }): InstallLogRecord {
    const out = maskSecrets(rec.output ?? '');
    const full: InstallLogRecord = {
      ...rec,
      ts: rec.ts ?? new Date().toISOString(),
      output: out.length > 2000 ? out.slice(-2000) : out,
    };
    mkdirSync(dirname(this.file), { recursive: true });
    appendFileSync(this.file, JSON.stringify(full) + '\n');
    return full;
  }
  read(): InstallLogRecord[] {
    if (!existsSync(this.file)) return [];
    return readFileSync(this.file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .flatMap((l) => {
        try {
          return [JSON.parse(l) as InstallLogRecord];
        } catch {
          return [];
        }
      });
  }
}
