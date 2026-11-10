import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import ts from 'typescript';
import { PluginManifestSchema, type Permissions, type PluginManifest } from '@harness-x/protocol';
import { validateSkillMd } from '@harness-x/sdk';
import type { ForgeSpec } from './spec.js';

/**
 * T-052 52.1 / 52.2 정적 검사
 * - 매니페스트: JSON·스키마·spec id·종류 슬롯·main ↔ src/index.ts
 * - 타입체크: 플러그인 tsconfig.json으로 TypeScript 프로그램을 만들어 진단(내보내지 않음)
 * - SKILL.md: 스킬이면 필수, 있으면 프런트매터 검증(name·description)
 * - 권한 최소화 린트: 코드(AST)가 실제로 쓰는 ctx.fs/net/shell·fetch와 선언한 권한을 비교
 *   선언했지만 안 쓰는 권한 → 제거 제안(suggestions), 쓰는데 선언 안 한 권한 → 오류(격리 실행에서 거부되므로)
 */

export type CheckKind = 'manifest' | 'typecheck' | 'skill-md' | 'permission';

export interface CheckIssue {
  kind: CheckKind;
  message: string;
  file?: string;
}

export interface PermissionSuggestion {
  permission: 'fs' | 'net' | 'shell';
  /** 지금 선언 */
  declared: unknown;
  /** 제안 */
  suggested: unknown;
  message: string;
}

export interface PermissionUsage {
  fsRead: boolean;
  fsWrite: boolean;
  net: boolean;
  shell: boolean;
}

export interface CheckReport {
  ok: boolean;
  errors: CheckIssue[];
  suggestions: PermissionSuggestion[];
  /** 제안을 모두 받아들인 권한 */
  minimized?: Permissions;
  usage?: PermissionUsage;
  manifest?: PluginManifest;
}

export const MANIFEST = 'harness-plugin.json';

// ── 매니페스트 ───────────────────────────────────────────────
export function checkManifest(
  dir: string,
  spec?: ForgeSpec,
): { manifest?: PluginManifest; errors: CheckIssue[] } {
  const file = join(dir, MANIFEST);
  const err = (message: string): CheckIssue => ({ kind: 'manifest', message, file: MANIFEST });
  if (!existsSync(file)) return { errors: [err(`${MANIFEST} 없음`)] };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    return { errors: [err(`${MANIFEST} JSON 오류: ${e instanceof Error ? e.message : String(e)}`)] };
  }
  const r = PluginManifestSchema.safeParse(raw);
  if (!r.success)
    return { errors: r.error.issues.map((i) => err(`${i.path.join('.') || '(root)'}: ${i.message}`)) };
  const m = r.data;
  const errors: CheckIssue[] = [];
  if (m.apiVersion !== 1) errors.push(err(`지원하지 않는 apiVersion ${m.apiVersion}`));
  if (spec && m.id !== spec.id) errors.push(err(`id '${m.id}'가 spec id '${spec.id}'와 다름`));
  if (spec && !(m.provides[spec.kind]?.length ?? 0))
    errors.push(err(`provides.${spec.kind}가 비어 있음 (spec 종류 ${spec.kind})`));
  const srcMain = m.main.replace(/^(\.\/)?dist\//, 'src/').replace(/\.js$/, '.ts');
  if (srcMain === m.main) {
    if (!existsSync(join(dir, m.main))) errors.push(err(`main 파일 없음: ${m.main}`));
  } else if (!existsSync(join(dir, srcMain))) errors.push(err(`main ${m.main}의 소스 ${srcMain} 없음`));
  return { manifest: m, errors };
}

// ── 타입체크 / 빌드 ──────────────────────────────────────────
export interface CompileResult {
  ok: boolean;
  errors: CheckIssue[];
  /** emit이면 쓴 파일 */
  emitted: string[];
}

/** 플러그인 tsconfig.json으로 컴파일 (emit=false면 타입체크만) */
export function compilePlugin(dir: string, opts: { emit?: boolean } = {}): CompileResult {
  const configFile = join(dir, 'tsconfig.json');
  const err = (message: string, file?: string): CheckIssue => ({
    kind: 'typecheck',
    message,
    ...(file ? { file } : {}),
  });
  if (!existsSync(configFile)) return { ok: false, errors: [err('tsconfig.json 없음')], emitted: [] };
  const read = ts.readConfigFile(configFile, (p) => ts.sys.readFile(p));
  if (read.error)
    return {
      ok: false,
      errors: [err(ts.flattenDiagnosticMessageText(read.error.messageText, '\n'))],
      emitted: [],
    };
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, dir);
  if (parsed.errors.length)
    return {
      ok: false,
      errors: parsed.errors.map((d) => err(ts.flattenDiagnosticMessageText(d.messageText, '\n'))),
      emitted: [],
    };
  const options: ts.CompilerOptions = {
    ...parsed.options,
    noEmit: !opts.emit,
    // 플러그인 폴더 밖의 @types를 끌어오지 않는다
    typeRoots: [],
  };
  const program = ts.createProgram(parsed.fileNames, options);
  const diags = [...ts.getPreEmitDiagnostics(program)];
  const emitted: string[] = [];
  if (opts.emit && diags.length === 0) {
    const r = program.emit(undefined, (fileName, text) => {
      ts.sys.writeFile(fileName, text);
      emitted.push(relative(dir, fileName).split(sep).join('/'));
    });
    diags.push(...r.diagnostics);
  }
  const errors = diags
    .filter((d) => d.category === ts.DiagnosticCategory.Error)
    .map((d) => {
      const msg = ts.flattenDiagnosticMessageText(d.messageText, '\n');
      if (!d.file || d.start === undefined) return err(`TS${d.code}: ${msg}`);
      const { line, character } = d.file.getLineAndCharacterOfPosition(d.start);
      const rel = relative(dir, d.file.fileName).split(sep).join('/');
      return err(`${rel}:${line + 1}:${character + 1} TS${d.code}: ${msg}`, rel);
    });
  return { ok: errors.length === 0, errors, emitted };
}

export const typecheckPlugin = (dir: string) => compilePlugin(dir).errors;

// ── SKILL.md ────────────────────────────────────────────────
export function checkSkillMd(dir: string, required: boolean): CheckIssue[] {
  const file = join(dir, 'SKILL.md');
  if (!existsSync(file))
    return required
      ? [{ kind: 'skill-md', message: 'SKILL.md 없음 (스킬 플러그인은 필수)', file: 'SKILL.md' }]
      : [];
  const r = validateSkillMd(readFileSync(file, 'utf8'));
  return r.errors.map((message) => ({ kind: 'skill-md' as const, message, file: 'SKILL.md' }));
}

// ── 52.2 권한 사용 분석 ─────────────────────────────────────
const FS_WRITE = new Set(['writeFile', 'appendFile', 'mkdir', 'rm', 'unlink', 'rename']);

function sourceFiles(dir: string): string[] {
  const root = join(dir, 'src');
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const visit = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      const full = join(d, name);
      if (statSync(full).isDirectory()) visit(full);
      else if (/\.(ts|tsx|mts|js|mjs)$/.test(name) && !name.endsWith('.d.ts')) out.push(full);
    }
  };
  visit(root);
  return out;
}

/** 코드가 실제로 쓰는 권한 (주석·문자열은 보지 않는다) */
export function analyzePermissionUsage(dir: string): PermissionUsage {
  const usage: PermissionUsage = { fsRead: false, fsWrite: false, net: false, shell: false };
  for (const file of sourceFiles(dir)) {
    const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.ES2022, true);
    const visit = (n: ts.Node) => {
      if (ts.isPropertyAccessExpression(n)) {
        const name = n.name.text;
        if (name === 'shell') usage.shell = true;
        if (name === 'net') usage.net = true;
        // <x>.fs.<method>
        if (ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'fs') {
          if (FS_WRITE.has(name)) usage.fsWrite = true;
          else usage.fsRead = true;
        }
      }
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'fetch')
        usage.net = true;
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return usage;
}

export function lintPermissions(
  declared: Permissions,
  usage: PermissionUsage,
): { errors: CheckIssue[]; suggestions: PermissionSuggestion[]; minimized: Permissions } {
  const errors: CheckIssue[] = [];
  const suggestions: PermissionSuggestion[] = [];
  const minimized: Permissions = { fs: [...declared.fs], net: [...declared.net], shell: declared.shell };
  const perm = (message: string): CheckIssue => ({ kind: 'permission', message, file: MANIFEST });

  // 쓰는데 선언 안 함 → 격리 실행에서 거부된다
  if (usage.shell && !declared.shell)
    errors.push(perm('코드가 ctx.shell을 쓰지만 permissions.shell이 false'));
  if (usage.net && declared.net.length === 0)
    errors.push(perm('코드가 네트워크를 쓰지만 permissions.net이 비어 있음'));
  if (usage.fsWrite && !declared.fs.includes('workspace:write'))
    errors.push(perm('코드가 파일을 쓰지만 workspace:write 권한이 없음'));
  else if (usage.fsRead && declared.fs.length === 0)
    errors.push(perm('코드가 파일을 읽지만 workspace:read 권한이 없음'));

  // 선언했지만 안 씀 → 제거 제안
  if (declared.shell && !usage.shell) {
    minimized.shell = false;
    suggestions.push({
      permission: 'shell',
      declared: true,
      suggested: false,
      message: '셸 권한을 선언했지만 코드에서 ctx.shell을 쓰지 않음 — 제거하세요',
    });
  }
  if (declared.net.length && !usage.net) {
    minimized.net = [];
    suggestions.push({
      permission: 'net',
      declared: declared.net,
      suggested: [],
      message: `네트워크 권한(${declared.net.join(', ')})을 선언했지만 코드에서 쓰지 않음 — 제거하세요`,
    });
  }
  if (declared.fs.length) {
    const need: Permissions['fs'] = usage.fsWrite
      ? ['workspace:write']
      : usage.fsRead
        ? ['workspace:read']
        : [];
    const same = need.length === declared.fs.length && need.every((x) => declared.fs.includes(x));
    if (!same) {
      minimized.fs = need;
      suggestions.push({
        permission: 'fs',
        declared: declared.fs,
        suggested: need,
        message: need.length
          ? `파일은 읽기만 함 — ${declared.fs.join(', ')} 대신 ${need.join(', ')}`
          : `파일 권한(${declared.fs.join(', ')})을 선언했지만 코드에서 ctx.fs를 쓰지 않음 — 제거하세요`,
      });
    }
  }
  return { errors, suggestions, minimized };
}

// ── 모두 ────────────────────────────────────────────────────
export function runChecks(dir: string, spec?: ForgeSpec): CheckReport {
  const m = checkManifest(dir, spec);
  const errors: CheckIssue[] = [...m.errors];
  errors.push(...compilePlugin(dir).errors);
  const isSkill = spec?.kind === 'skill' || (m.manifest?.provides.skill?.length ?? 0) > 0;
  errors.push(...checkSkillMd(dir, isSkill));
  let suggestions: PermissionSuggestion[] = [];
  let minimized: Permissions | undefined;
  let usage: PermissionUsage | undefined;
  if (m.manifest) {
    usage = analyzePermissionUsage(dir);
    const lint = lintPermissions(m.manifest.permissions, usage);
    errors.push(...lint.errors);
    suggestions = lint.suggestions;
    minimized = lint.minimized;
  }
  return {
    ok: errors.length === 0,
    errors,
    suggestions,
    ...(minimized ? { minimized } : {}),
    ...(usage ? { usage } : {}),
    ...(m.manifest ? { manifest: m.manifest } : {}),
  };
}
