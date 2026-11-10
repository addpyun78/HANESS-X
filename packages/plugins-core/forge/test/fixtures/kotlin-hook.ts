/**
 * 가짜 엔진이 scaffold 노드에서 "작성"하는 본문들 (EPIC 5 게이트 시나리오: PR 전 Kotlin 린트 가드)
 * 실제 LLM 대신 이 문자열을 {"files": {"src/index.ts": ...}} 로 돌려준다.
 */

const HEADER = `/**
 * PR 전 Kotlin 린트 가드 — tool.before 차단형 훅
 * gh pr create 를 실행하려 하면 먼저 ./gradlew ktlintCheck 를 돌리고, 실패하면 막는다.
 * 격리 실행: Node 내장 모듈 대신 ctx.shell 만 쓴다.
 */

export interface HookContext {
  sessionId?: string;
  tool?: string;
  input?: unknown;
  [key: string]: unknown;
}

export interface HookResult {
  decision: 'allow' | 'deny' | 'block';
  reason?: string;
}

export interface PluginContext {
  manifest: { id: string; version: string };
  log(message: string): void;
  hooks: {
    onBlocking(
      name: 'tool.before',
      handler: (ctx: HookContext) => HookResult | void | Promise<HookResult | void>,
    ): () => void;
  };
  shell: { exec(cmd: string, args?: string[]): Promise<{ code: number; stdout: string; stderr: string }> };
}

const TARGET = /\\bgh\\s+pr\\s+create\\b/;
const LINT = ['./gradlew', 'ktlintCheck'];

/** 훅 컨텍스트에서 실행하려는 명령 글 */
export function commandOf(input: unknown): string {
  if (typeof input === 'string') return input;
  if (input && typeof input === 'object') {
    const o = input as Record<string, unknown>;
    for (const k of ['command', 'cmd']) if (typeof o[k] === 'string') return o[k] as string;
    if (Array.isArray(o.argv)) return o.argv.join(' ');
  }
  return '';
}
`;

/** 올바른 본문 */
export const KOTLIN_HOOK_OK =
  HEADER +
  `
export function activate(ctx: PluginContext): void {
  ctx.hooks.onBlocking('tool.before', async (c) => {
    if (!TARGET.test(commandOf(c.input))) return { decision: 'allow' };
    const r = await ctx.shell.exec('sh', LINT);
    if (r.code !== 0)
      return {
        decision: 'block',
        reason: \`Kotlin 린트 실패 (\${LINT.join(' ')} → \${r.code}): \${(r.stderr || r.stdout).trim().slice(0, 500)}\`,
      };
    return { decision: 'allow' };
  });
}

export function deactivate(): void {}
`;

/** 타입 오류가 있는 본문 (정적 검사에서 거부) */
export const KOTLIN_HOOK_TYPE_ERROR =
  HEADER +
  `
export function activate(ctx: PluginContext): void {
  const limit: number = 'many';
  ctx.log(String(limit));
}
`;

/** 컴파일은 되지만 린트 결과를 보지 않아 항상 허용 (샌드박스 시험에서 실패) */
export const KOTLIN_HOOK_ALWAYS_ALLOW =
  HEADER +
  `
export function activate(ctx: PluginContext): void {
  ctx.hooks.onBlocking('tool.before', async (c) => {
    if (!TARGET.test(commandOf(c.input))) return { decision: 'allow' };
    await ctx.shell.exec('sh', LINT);
    return { decision: 'allow' };
  });
}
`;

/** 가짜 엔진 응답 (```json {files} ```) */
export const filesReply = (body: string, extra: Record<string, string> = {}) =>
  '본문을 작성했습니다.\n```json\n' + JSON.stringify({ files: { 'src/index.ts': body, ...extra } }) + '\n```';
