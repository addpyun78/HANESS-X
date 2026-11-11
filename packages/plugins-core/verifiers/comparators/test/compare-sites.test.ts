import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * D.6 직접 비교 grep — 기대값/실제값을 `===`·`!==`·`includes`·정규식으로 직접 맞대는 줄이
 * 허용 목록(docs/tickets/T-100-compare-sites.md의 `allow:` 줄) 밖에 0건이어야 한다.
 */
const REPO = fileURLToPath(new URL('../../../../../', import.meta.url));
const SITES_DOC = join(REPO, 'docs/tickets/T-100-compare-sites.md');

/** 기대값/실제값 쪽 피연산자 (멤버 접근 허용: acc.expectExit, ex.expect.decision, mapped(expKey)) */
const SUBJ = String.raw`(?:\b(?:[\w$]+\.)*(?:expect\w*|actual\w*|symbol|expKey)\b(?:\.\w+)*|\bmapped\([^)]*\))`;
/** undefined·null과의 비교는 값 판정이 아니다 */
const NOT_NIL = String.raw`(?!\s*(?:undefined|null)\b)`;
export const DIRECT_COMPARE_RE = new RegExp(
  [
    `${SUBJ}\\s*(?:===|!==)${NOT_NIL}`,
    `(?:===|!==)\\s*${SUBJ}`,
    `\\.includes\\(\\s*${SUBJ}`,
    `${SUBJ}\\.includes\\(`,
    `\\.(?:test|match)\\(\\s*${SUBJ}`,
  ].join('|'),
);

interface Allow {
  file: string;
  snippet?: string;
}

function allowList(): Allow[] {
  return readFileSync(SITES_DOC, 'utf8')
    .split('\n')
    .flatMap((l) => {
      const m = /^- allow: (.+?) — /.exec(l);
      if (!m) return [];
      const [file, snippet] = m[1]!.split('|');
      return [{ file: file!.trim(), ...(snippet ? { snippet: snippet.trim() } : {}) }];
    });
}

function* sources(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === 'test' || name.startsWith('.')) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) yield* sources(p);
    else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name) && !name.endsWith('.d.ts'))
      yield p;
  }
}

function srcRoots(): string[] {
  const out: string[] = [];
  const walk = (d: string, depth: number) => {
    for (const name of readdirSync(d)) {
      if (name === 'node_modules' || name.startsWith('.')) continue;
      const p = join(d, name);
      if (!statSync(p).isDirectory()) continue;
      if (name === 'src') out.push(p);
      else if (depth < 4) walk(p, depth + 1);
    }
  };
  walk(join(REPO, 'packages'), 0);
  walk(join(REPO, 'apps'), 0);
  return out;
}

describe('D.6 직접 비교 지점 → 비교기 호출 (허용 목록 제외 0건)', () => {
  it('검사 패턴이 A.2에서 찾은 교체 대상(원래 코드 줄)을 잡고, undefined 비교·비교기 호출은 잡지 않는다', () => {
    for (const line of [
      'ok: code === acc.expectExit,',
      'if (text.includes(acc.symbol))',
      "if (kind === 'file') return mapped(key) === mapped(expKey) ? key : null;",
      'if (out.decision !== ex.expect.decision)',
      "if (ex.expect.reasonContains && !(out.reason ?? '').includes(ex.expect.reasonContains))",
      'if (/^ok$/.test(actualOutput))',
    ])
      expect(DIRECT_COMPARE_RE.test(line), line).toBe(true);
    for (const line of [
      'acc.expectOutput !== undefined',
      "if (compareValues('exact', ex.expect.decision, out.decision, cc).next !== 'pass')",
      "expect: kind === 'hook' ? { decision: 'allow' } : {},",
    ])
      expect(DIRECT_COMPARE_RE.test(line), line).toBe(false);
  });

  it('경로 L1·L2(교체 대상 3·4)는 비교기 패키지로 옮겨 사다리에는 다시 내보내기만 남았다', () => {
    for (const f of ['normalize.ts', 'alias.ts']) {
      const src = readFileSync(join(REPO, 'packages/plugins-core/verifiers/ladder/src', f), 'utf8');
      expect(src).toMatch(/from '@harness-x\/comparators'/);
      expect(src).not.toMatch(/===|!==/);
    }
    const path = readFileSync(
      join(REPO, 'packages/plugins-core/verifiers/comparators/src/comparators/path.ts'),
      'utf8',
    );
    expect(path).toMatch(/export function pathsEqualL1[\s\S]+pathComparator\.equals/);
    expect(path).toMatch(/export function pathsEqualL2[\s\S]+pathComparator\.equals/);
  });

  it('packages·apps의 src에 허용 목록 밖 직접 비교 0건', () => {
    const allow = allowList();
    expect(allow.length).toBeGreaterThan(0);
    const hits: string[] = [];
    for (const root of srcRoots())
      for (const file of sources(root)) {
        const rel = relative(REPO, file).split('\\').join('/');
        readFileSync(file, 'utf8')
          .split('\n')
          .forEach((line, k) => {
            if (!DIRECT_COMPARE_RE.test(line)) return;
            const ok = allow.some((a) =>
              a.snippet ? rel === a.file && line.includes(a.snippet) : rel.startsWith(a.file),
            );
            if (!ok) hits.push(`${rel}:${k + 1}: ${line.trim()}`);
          });
      }
    expect(hits).toEqual([]);
  });
});
