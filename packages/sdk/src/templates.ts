import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { PermissionsSchema } from '@harness-x/protocol';

/**
 * 템플릿 레지스트리 (packages/sdk/templates/<종류>/)
 * 각 템플릿은 그 자체로 빌드되는 플러그인 패키지 골격이다 (package.json·tsconfig.json·harness-plugin.json·src/).
 *
 * 치환 문법
 * - {{name}}        : 값을 그대로 넣는다 (id처럼 안전한 값, 마크다운 본문)
 * - '{{json:name}}' / "{{json:name}}" : 따옴표째 JSON 리터럴로 바꾼다 (JSON·YAML·TS 문자열/객체 어디서나 유효)
 */

export const TEMPLATE_KINDS = ['skill', 'tool', 'hook', 'pipeline', 'panel'] as const;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];

/** 템플릿 폴더 안에서 스캐폴드 결과에 넣지 않는 파일 */
const META_FILE = 'template.json';

export interface TemplateInfo {
  kind: TemplateKind;
  slot: string;
  description: string;
  dir: string;
  files: string[];
}

const ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const TemplateVarsSchema = z
  .object({
    /** 플러그인 id (소문자 kebab-case, 파이프라인 이름·/명령으로도 쓰인다) */
    id: z.string().regex(ID_RE, { message: 'id는 소문자 kebab-case' }),
    /** 표시 이름 (한 줄, 주석을 닫는 문자열 금지) */
    displayName: z
      .string()
      .min(1)
      .max(80)
      .refine((s) => !/[\r\n]/.test(s) && !s.includes('*/'), { message: 'displayName은 한 줄, */ 금지' }),
    description: z.string().min(1).max(1024),
    permissions: PermissionsSchema.default({ fs: [], net: [], shell: false }),
  })
  .strict();
export type TemplateVars = z.infer<typeof TemplateVarsSchema>;
export type TemplateVarsInput = z.input<typeof TemplateVarsSchema>;

/** 템플릿 폴더 (src/와 dist/ 모두 한 단계 아래라 같은 상대 경로) */
export function templatesDir(): string {
  return fileURLToPath(new URL('../templates/', import.meta.url));
}

export function listTemplates(root = templatesDir()): TemplateInfo[] {
  return TEMPLATE_KINDS.filter((k) => existsSync(join(root, k, META_FILE))).map((kind) => {
    const dir = join(root, kind);
    const meta = JSON.parse(readFileSync(join(dir, META_FILE), 'utf8')) as {
      slot: string;
      description: string;
    };
    return { kind, slot: meta.slot, description: meta.description, dir, files: walk(dir) };
  });
}

export class TemplateVarError extends Error {}

/** 50.2 치환기. 모르는 변수는 오류 */
export function substitute(text: string, vars: TemplateVars): string {
  const values = vars as unknown as Record<string, unknown>;
  const lookup = (name: string): unknown => {
    if (!(name in values)) throw new TemplateVarError(`모르는 템플릿 변수: ${name}`);
    return values[name];
  };
  return text
    .replace(/(["'])\{\{json:(\w+)\}\}\1/g, (_m, _q, name: string) => JSON.stringify(lookup(name)))
    .replace(/\{\{(\w+)\}\}/g, (_m, name: string) => {
      const v = lookup(name);
      if (typeof v !== 'string')
        throw new TemplateVarError(`{{${name}}}는 문자열이 아님: {{json:${name}}}을 쓰세요`);
      return v;
    });
}

/** 템플릿을 메모리에서 렌더링: 상대 경로 → 내용 */
export function renderTemplate(
  kind: TemplateKind,
  input: TemplateVarsInput,
  root = templatesDir(),
): Record<string, string> {
  const vars = TemplateVarsSchema.parse(input);
  const dir = join(root, kind);
  if (!existsSync(join(dir, META_FILE))) throw new Error(`없는 템플릿: ${kind}`);
  const out: Record<string, string> = {};
  for (const rel of walk(dir)) out[rel] = substitute(readFileSync(join(dir, rel), 'utf8'), vars);
  return out;
}

/** 템플릿을 dest 폴더에 펼친다 (dest는 없거나 비어 있어야 함). 쓴 파일의 상대 경로 목록 */
export function scaffold(
  kind: TemplateKind,
  dest: string,
  input: TemplateVarsInput,
  root = templatesDir(),
): string[] {
  if (existsSync(dest) && readdirSync(dest).length > 0)
    throw new Error(`대상 폴더가 비어 있지 않음: ${dest}`);
  const files = renderTemplate(kind, input, root);
  for (const [rel, content] of Object.entries(files)) {
    const file = join(dest, rel);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  return Object.keys(files);
}

function walk(dir: string): string[] {
  const out: string[] = [];
  const visit = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      if (name === 'node_modules' || name === 'dist') continue;
      const full = join(d, name);
      if (statSync(full).isDirectory()) visit(full);
      else out.push(relative(dir, full).split(sep).join('/'));
    }
  };
  visit(dir);
  return out.filter((f) => f !== META_FILE);
}
