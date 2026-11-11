import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { MESSAGES } from './messages.js';
import type { AddResult, AttachmentStore } from './store.js';

/**
 * 1B.10 폴더 드롭: 파일 목록 수집(.gitignore 존중 — 폴더마다의 .gitignore도),
 * 50개가 넘으면 "파일이 많아요. 다 넣을까요?"를 먼저 묻는다.
 * .gitignore 규칙은 직접 구현(새 패키지 없이): *, **, ?, 앞 / (기준 고정), 뒤 / (폴더만), ! (다시 포함).
 */

interface Rule {
  re: RegExp;
  negate: boolean;
  dirOnly: boolean;
  /** 규칙이 적힌 .gitignore 폴더 (루트 기준, / 구분) */
  base: string;
}

function globToRegex(glob: string, anchored: boolean): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === '*') {
      if (glob[i + 1] === '*') {
        const slash = glob[i + 2] === '/';
        re += slash ? '(?:.*/)?' : '.*';
        i += slash ? 2 : 1;
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if (c === '[') {
      const j = glob.indexOf(']', i);
      if (j < 0) re += '\\[';
      else {
        re += `[${glob.slice(i + 1, j).replace(/^!/, '^')}]`;
        i = j;
      }
    } else re += c.replace(/[.+^${}()|\\]/g, '\\$&');
  }
  return new RegExp(`^${anchored ? '' : '(?:.*/)?'}${re}$`);
}

export function parseGitignore(text: string, base = ''): Rule[] {
  const rules: Rule[] = [];
  for (let line of text.split(/\r?\n/)) {
    if (!line.trim() || line.startsWith('#')) continue;
    line = line.replace(/(?<!\\)\s+$/, '');
    const negate = line.startsWith('!');
    if (negate) line = line.slice(1);
    const dirOnly = line.endsWith('/');
    if (dirOnly) line = line.slice(0, -1);
    const anchored = line.startsWith('/') || line.includes('/');
    if (line.startsWith('/')) line = line.slice(1);
    rules.push({ re: globToRegex(line, anchored), negate, dirOnly, base });
  }
  return rules;
}

/**
 * 규칙들로 보면 무시되는지 (마지막에 맞은 규칙이 이김).
 * 무시된 폴더는 아예 들어가지 않으므로 경로 자신만 검사하면 된다.
 */
export function isIgnored(rules: readonly Rule[], relPath: string, isDir: boolean): boolean {
  let ignored = false;
  for (const r of rules) {
    if (r.base && !relPath.startsWith(`${r.base}/`)) continue;
    if (r.dirOnly && !isDir) continue;
    const p = r.base ? relPath.slice(r.base.length + 1) : relPath;
    if (r.re.test(p)) ignored = !r.negate;
  }
  return ignored;
}

export interface FolderScan {
  root: string;
  /** 루트 기준 상대 경로 (/ 구분) */
  files: string[];
  /** 50개(설정)를 넘으면 true → 화면이 먼저 묻는다 */
  needsConfirm: boolean;
  /** needsConfirm일 때 물을 말 */
  question?: string;
}

/** 늘 빼는 것 */
const ALWAYS_SKIP = new Set(['.git', '.harness-x']);

export function scanFolder(root: string, o: { confirmOver?: number; maxFiles?: number } = {}): FolderScan {
  const files: string[] = [];
  const maxFiles = o.maxFiles ?? 10_000;
  const walk = (dir: string, rules: Rule[]) => {
    const gi = join(dir, '.gitignore');
    const relDir = relative(root, dir).split(sep).join('/');
    const here = existsSync(gi) ? [...rules, ...parseGitignore(readFileSync(gi, 'utf8'), relDir)] : rules;
    for (const name of readdirSync(dir).sort()) {
      if (files.length >= maxFiles) return;
      if (ALWAYS_SKIP.has(name)) continue;
      const abs = join(dir, name);
      const rel = relative(root, abs).split(sep).join('/');
      const st = statSync(abs);
      if (isIgnored(here, rel, st.isDirectory())) continue;
      if (st.isDirectory()) walk(abs, here);
      else if (st.isFile()) files.push(rel);
    }
  };
  walk(root, []);
  const over = o.confirmOver ?? 50;
  const needsConfirm = files.length > over;
  return {
    root,
    files,
    needsConfirm,
    ...(needsConfirm ? { question: MESSAGES.folderTooMany } : {}),
  };
}

export type FolderAttachResult =
  | { status: 'confirm'; question: string; count: number }
  | { status: 'added'; results: AddResult[]; scan: FolderScan };

/** 폴더 넣기: 많으면 confirmed 없이는 아무것도 넣지 않고 물어본다 */
export async function attachFolder(
  store: AttachmentStore,
  sessionId: string,
  folder: string,
  o: { confirmed?: boolean } = {},
): Promise<FolderAttachResult> {
  const scan = scanFolder(folder, { confirmOver: store.limits.folderConfirmOver });
  if (scan.needsConfirm && !o.confirmed)
    return { status: 'confirm', question: scan.question!, count: scan.files.length };
  const results = await store.addMany(
    sessionId,
    scan.files.map((f) => ({ name: f.split('/').pop()!, path: join(folder, f) })),
  );
  return { status: 'added', results, scan };
}
