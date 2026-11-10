import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';
import { scaffold } from '@harness-x/sdk';
import type { ForgeSpec } from './spec.js';

/**
 * 51.4 scaffold: spec으로 템플릿(packages/sdk/templates/<kind>)을 채우고, 엔진이 쓴 본문을 얹는다.
 * - 매니페스트·package.json·tsconfig.json은 하네스가 spec으로 만든다(엔진이 덮어쓸 수 없음).
 * - 엔진은 src/**, SKILL.md, README.md, pipelines/** 만 쓸 수 있다.
 */

/** 엔진이 쓰면 안 되는 파일 (하네스가 spec으로 관리) */
export const PROTECTED_FILES = ['harness-plugin.json', 'package.json', 'tsconfig.json'];

export class ScaffoldPathError extends Error {}

export interface FileWrite {
  path: string;
  change: 'create' | 'modify';
}

/** 템플릿 변수 */
export function templateVars(spec: ForgeSpec) {
  return {
    id: spec.id,
    displayName: spec.displayName,
    description: spec.description,
    permissions: spec.permissions,
  };
}

/** 빈 폴더에 템플릿을 펼친다 (이미 있으면 그대로 둔다). 쓴 파일 목록 */
export function scaffoldFromSpec(spec: ForgeSpec, dir: string): string[] {
  if (existsSync(join(dir, 'harness-plugin.json'))) return [];
  return scaffold(spec.kind, dir, templateVars(spec));
}

/** 엔진이 쓸 수 있는 경로인지 (상대 경로, 폴더 탈출·보호 파일 금지) */
export function checkWritablePath(rel: string): string {
  const p = rel.replace(/\\/g, '/').trim();
  if (!p || isAbsolute(p) || /^[A-Za-z]:/.test(p)) throw new ScaffoldPathError(`절대 경로 금지: ${rel}`);
  const norm = normalize(p).split(sep).join('/');
  if (norm.startsWith('..') || norm.split('/').includes('..'))
    throw new ScaffoldPathError(`폴더 밖 경로 금지: ${rel}`);
  if (PROTECTED_FILES.includes(norm)) throw new ScaffoldPathError(`하네스가 관리하는 파일: ${rel}`);
  const top = norm.split('/')[0]!;
  const allowed = top === 'src' || top === 'pipelines' || norm === 'SKILL.md' || norm === 'README.md';
  if (!allowed)
    throw new ScaffoldPathError(`엔진이 쓸 수 없는 경로: ${rel} (src/**, SKILL.md, README.md, pipelines/**)`);
  return norm;
}

/** 엔진이 쓴 파일들을 플러그인 폴더에 쓴다 */
export function applyFiles(dir: string, files: Record<string, string>): FileWrite[] {
  const out: FileWrite[] = [];
  for (const [rel, content] of Object.entries(files)) {
    const norm = checkWritablePath(rel);
    const file = resolve(dir, norm);
    const r = relative(resolve(dir), file);
    if (r.startsWith('..') || isAbsolute(r)) throw new ScaffoldPathError(`폴더 밖 경로 금지: ${rel}`);
    const existed = existsSync(file);
    if (existed && readFileSync(file, 'utf8') === content) continue;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
    out.push({ path: norm, change: existed ? 'modify' : 'create' });
  }
  return out;
}

/** 엔진에 보여 줄 현재 본문 (src/index.ts, SKILL.md) */
export function currentBody(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rel of ['src/index.ts', 'SKILL.md']) {
    const f = join(dir, rel);
    if (existsSync(f)) out[rel] = readFileSync(f, 'utf8');
  }
  return out;
}
