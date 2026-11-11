import { closeSync, existsSync, openSync, readdirSync, readSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { sanitizeText } from './filter.js';
import { pluginHealth } from './health.js';
import type { InventoryPluginSource } from './plugins.js';
import type { SkillAsset } from './schema.js';
import { extractTags } from './text.js';

/**
 * P4-A.3 스킬 수집: SKILL.md 프런트매터(name, description) + 소속 플러그인 + 태그.
 * 파일 앞부분(최대 8KB)만 읽어 프런트매터만 해석한다 — 본문은 인벤토리에 넣지 않는다.
 */

export const SKILL_FILE = 'SKILL.md';
const HEAD_BYTES = 8 * 1024;

export interface SkillFrontmatter {
  name?: string;
  description?: string;
}

/** 파일 앞부분만 읽어 `---` 사이 YAML을 해석 (없거나 깨지면 {}) */
export function readSkillFrontmatter(file: string): SkillFrontmatter {
  let head = '';
  try {
    const fd = openSync(file, 'r');
    try {
      const buf = Buffer.alloc(HEAD_BYTES);
      const n = readSync(fd, buf, 0, HEAD_BYTES, 0);
      head = buf.subarray(0, n).toString('utf8');
    } finally {
      closeSync(fd);
    }
  } catch {
    return {};
  }
  if (head.charCodeAt(0) === 0xfeff) head = head.slice(1); // BOM
  const m = /^---\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/.exec(head);
  if (!m) return {};
  try {
    const v = parseYaml(m[1]!) as Record<string, unknown> | null;
    if (!v || typeof v !== 'object') return {};
    return {
      ...(typeof v.name === 'string' ? { name: v.name } : {}),
      ...(typeof v.description === 'string' ? { description: v.description } : {}),
    };
  } catch {
    return {};
  }
}

/** 플러그인 안에서 스킬 이름의 SKILL.md 찾기 */
function findSkillFile(dir: string, name: string, single: boolean): string | undefined {
  const candidates = [join(dir, 'skills', name, SKILL_FILE), join(dir, name, SKILL_FILE)];
  if (single) candidates.push(join(dir, SKILL_FILE));
  return candidates.find((f) => existsSync(f));
}

/** 한 줄로 정리 + 비밀 마스킹 (태그도 이 결과에서 뽑아 비밀이 새지 않게) */
const oneLine = (s: string) => sanitizeText(s);

export interface CollectSkillsOptions {
  /** 플러그인 밖 스킬 폴더 (<root>/<이름>/SKILL.md, 예: ~/.harness-x/skills) */
  skillRoots?: readonly string[];
}

export function collectSkills(
  plugins: Iterable<InventoryPluginSource>,
  opts: CollectSkillsOptions = {},
): SkillAsset[] {
  const out: SkillAsset[] = [];
  for (const p of plugins) {
    const names = p.manifest.provides.skill ?? [];
    for (const id of names) {
      const file = findSkillFile(p.dir, id, names.length === 1);
      const fm = file ? readSkillFrontmatter(file) : {};
      const description = oneLine(fm.description ?? p.manifest.description ?? '');
      out.push({
        id,
        name: fm.name ?? id,
        description,
        pluginId: p.manifest.id,
        tags: extractTags(`${fm.name ?? id} ${description}`),
        health: pluginHealth(p),
      });
    }
  }
  for (const root of opts.skillRoots ?? []) {
    if (!existsSync(root)) continue;
    for (const name of readdirSync(root).sort()) {
      const file = join(root, name, SKILL_FILE);
      if (!existsSync(file) || !statSync(file).isFile()) continue;
      const fm = readSkillFrontmatter(file);
      const description = oneLine(fm.description ?? '');
      out.push({
        id: name,
        name: fm.name ?? name,
        description,
        tags: extractTags(`${fm.name ?? name} ${description}`),
        health: 'ready',
      });
    }
  }
  return out;
}
