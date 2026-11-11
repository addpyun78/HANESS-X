import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { HookContext, HookResult } from '@harness-x/kernel';
import type { ToolEntry, ToolRegistry } from './registry.js';

/**
 * P2-F.3 AI 바로 탑재 ①: 세션 시작마다 자동 스킬 `installed-tools`를 만들어 엔진에 투영한다.
 *  - claude: <workspace>/.claude/skills/installed-tools/SKILL.md
 *  - codex 등 AGENTS 계열: <workspace>/.agents/skills/installed-tools/SKILL.md
 *  - 프롬프트로만 받는 엔진: contextText()를 세션 첫 메시지 앞에 붙인다
 * P2-F.5 진행 중 세션: 매 턴(prompt.submit) 도구 목록 revision이 바뀌었으면 다시 투영하고 바뀐 내용을 알린다.
 */

export const INSTALLED_TOOLS_SKILL = 'installed-tools';

export const SKILL_TARGETS: Record<string, string> = {
  claude: join('.claude', 'skills', INSTALLED_TOOLS_SKILL, 'SKILL.md'),
  agents: join('.agents', 'skills', INSTALLED_TOOLS_SKILL, 'SKILL.md'),
};

const PRICE_WORD: Record<string, string> = {
  free: '무료',
  freemium: '무료+유료 기능',
  trial: '체험판',
  paid: '유료',
  unknown: '무료인지 확인 못 함',
};

function toolLines(t: ToolEntry): string[] {
  return [
    `## ${t.name}`,
    `- 용도: ${t.purpose}`,
    `- 종류: ${t.kind} · ${PRICE_WORD[t.pricing.tier] ?? t.pricing.tier}${t.version ? ` · ${t.version}` : ''}`,
    ...(t.command ? [`- 실행 파일(절대 경로, PATH에 없어도 이 경로로 실행): \`${t.command}\``] : []),
    `- 사용 예: ${t.howToUse.map((h) => `\`${h}\``).join(', ')}`,
    '',
  ];
}

/** SKILL.md 본문 */
export function renderInstalledToolsSkill(tools: ToolEntry[]): string {
  const body = tools.length
    ? tools.flatMap(toolLines)
    : ['아직 설치 관리자로 설치한 도구가 없어요. 필요하면 install.search → install.plan으로 제안하세요.', ''];
  return [
    '---',
    `name: ${INSTALLED_TOOLS_SKILL}`,
    'description: 이 컴퓨터에 설치 관리자로 설치된 도구 목록과 실행 방법. 도구가 필요하면 먼저 여기서 찾고, 실행할 때는 적힌 절대 경로를 쓴다.',
    '---',
    '',
    '# 설치된 도구',
    '',
    '설치·제거는 사람만 할 수 있다. 없는 도구는 install.search / install.plan으로 계획만 제안한다.',
    '',
    ...body,
  ].join('\n');
}

/** 프롬프트용 짧은 문맥 */
export function contextText(tools: ToolEntry[]): string {
  if (!tools.length) return '[설치된 도구] 없음';
  return [
    '[설치된 도구]',
    ...tools.map(
      (t) => `- ${t.name}: ${t.purpose}${t.command ? ` — 실행: ${t.command}` : ''} (예: ${t.howToUse[0]})`,
    ),
  ].join('\n');
}

export interface ProjectionResult {
  revision: number;
  files: string[];
  context: string;
}

function atomicWrite(file: string, text: string) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}

export function projectInstalledToolsSkill(
  registry: ToolRegistry,
  workspace: string,
  targets: readonly string[] = Object.keys(SKILL_TARGETS),
): ProjectionResult {
  const r = registry.read();
  const text = renderInstalledToolsSkill(r.tools);
  const files = targets.map((t) => join(workspace, SKILL_TARGETS[t] ?? t));
  for (const f of files) atomicWrite(f, text);
  return { revision: r.revision, files, context: contextText(r.tools) };
}

/**
 * 세션별 투영 상태. session.start에서 투영, prompt.submit마다 revision 비교 → 바뀌었으면 재투영(F.5).
 */
export class InstalledToolsProjector {
  private readonly seen = new Map<string, number>();

  constructor(
    private readonly registry: ToolRegistry,
    private readonly workspace: (ctx: HookContext) => string,
    private readonly targets?: readonly string[],
  ) {}

  /** session.start */
  start(ctx: HookContext): ProjectionResult {
    const r = projectInstalledToolsSkill(this.registry, this.workspace(ctx), this.targets);
    this.seen.set(ctx.sessionId ?? 'default', r.revision);
    return r;
  }

  /** prompt.submit: 바뀐 게 있으면 재투영하고 엔진에 붙일 문맥을 돌려준다 */
  turn(ctx: HookContext): ProjectionResult | undefined {
    const sid = ctx.sessionId ?? 'default';
    const rev = this.registry.revision();
    if (this.seen.get(sid) === rev) return undefined;
    const r = projectInstalledToolsSkill(this.registry, this.workspace(ctx), this.targets);
    this.seen.set(sid, r.revision);
    return r;
  }

  /** HookBus/PluginContext.hooks에 설치 */
  install(hooks: {
    onNotify(name: 'session.start', h: (ctx: HookContext) => void, o?: { id?: string }): () => void;
    onBlocking(
      name: 'prompt.submit',
      h: (ctx: HookContext) => HookResult | void,
      o?: { id?: string; priority?: number },
    ): () => void;
  }): () => void {
    const a = hooks.onNotify('session.start', (ctx) => void this.start(ctx), {
      id: 'installer:installed-tools',
    });
    const b = hooks.onBlocking(
      'prompt.submit',
      (ctx) => {
        const r = this.turn(ctx);
        if (!r) return;
        return {
          decision: 'allow',
          patch: {
            installedTools: { revision: r.revision, context: `도구 목록이 바뀌었어요.\n${r.context}` },
          },
        };
      },
      { id: 'installer:installed-tools-reload', priority: 50 },
    );
    return () => {
      a();
      b();
    };
  }
}
