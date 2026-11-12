// T-102 점검 스크립트 공통 도우미
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  lstatSync,
} from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync, spawnSync } from 'node:child_process';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const auditDir = join(root, 'docs', 'audit');
export const rawDir = join(auditDir, 'raw');

/** 결과 파일: 기본 docs/audit/baseline.json, AUDIT_OUT=final.json이면 그 파일 */
export const outFile = join(auditDir, process.env.AUDIT_OUT || 'baseline.json');

export function readJson(file, fallback = undefined) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export function writeJson(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}

/** outFile의 key를 value로 바꿔 쓴다(나머지 키는 그대로) */
export function mergeOut(key, value) {
  const cur = readJson(outFile, {});
  cur[key] = value;
  cur.updatedAt = new Date().toISOString();
  writeJson(outFile, cur);
  return value;
}

export function sh(cmd, opts = {}) {
  return execSync(cmd, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 512,
    stdio: ['ignore', 'pipe', 'pipe'],
    ...opts,
  });
}

export function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { cwd: root, encoding: 'utf8', maxBuffer: 1024 * 1024 * 512, ...opts });
}

/** 심볼릭 링크는 따라가지 않고 바이트 합계 */
export function dirSize(dir, { skip = () => false } = {}) {
  let total = 0;
  let files = 0;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = join(d, e.name);
      if (skip(p, e)) continue;
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile()) {
        try {
          total += lstatSync(p).size;
          files++;
        } catch {
          /* 사라진 파일 */
        }
      }
    }
  }
  return { bytes: total, files };
}

export function listFiles(dir, filter = () => true, { skipDirs = ['node_modules', 'dist', '.git'] } = {}) {
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory()) {
        if (!skipDirs.includes(e.name)) stack.push(p);
      } else if (e.isFile() && filter(p)) out.push(p);
    }
  }
  return out.sort();
}

export const rel = (p) => relative(root, p).split('\\').join('/');
export const mb = (b) => Math.round((b / 1024 / 1024) * 10) / 10;
export { existsSync, readFileSync, writeFileSync, statSync, join };

/** 워크스페이스 패키지 목록 */
export async function workspacePackages() {
  const { listWorkspacePackages } = await import('../dev/workspace-packages.mjs');
  return listWorkspacePackages(root);
}
