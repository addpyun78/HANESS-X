import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { z } from 'zod';
import { settingsRegistry, type SettingsRegistry } from './registry.js';

/**
 * T-101 0A.10 재발 방지 검사 도우미 — "코드에서 쓰는 설정 키 ⊆ 레지스트리 키".
 * 코드에서 설정 키를 쓰는 모양 세 가지를 찾는다:
 *  1) `readSetting(값, '<키>')` 호출 (새 코드의 기본 방법)
 *  2) 설정 파일(settings.json)을 읽거나 이름에 settings가 들어간 파일 안의 따옴표 키 '<이름공간>.<이름>'
 *     (예: to['judge.semantic'], 주석의 `judge.engine`)
 *  3) 브라우저 저장소 이름 상수 (`*_KEY = 'hx…'`) — 레지스트리 browserKey이거나 설정 아님 목록에 있어야 한다
 * 그리고 설정 구역 Zod 스키마(예: judge 패키지 JudgeSettingsSchema)의 키를 펼쳐 비교한다.
 */

export interface CodeKeyHit {
  key: string;
  file: string;
  line: number;
  how: 'readSetting' | 'literal' | 'schema' | 'browser';
}

/** 설정 키가 아닌데 설정 이름공간처럼 보이는 글자 (이유와 함께) */
export const NOT_SETTING_KEYS: Readonly<Record<string, string>> = {
  'verifier.l4': '폐기된 키 — 읽으면 judge.*로 자동 이전(ladder migrateVerifierConfig)',
};

/** 설정이 아닌 브라우저 저장 이름 (이유와 함께) */
export const NOT_SETTING_BROWSER_KEYS: Readonly<Record<string, string>> = {
  'hx-token': '서버 접속 열쇠 (비밀, 화면 노출 금지)',
  'hx-layout': '열 너비·패널 순서 (화면 상태)',
  'hx.approvals.notify-asked': '알림 권한을 이미 물었는지 기록',
  'hx.builder.animation': 'builder.animation 설정의 화면 쪽 사본',
  'hx.stt.browser.consent': '브라우저 음성 인식 동의 기록 (한 번 묻기)',
  'hx.forge.prefill': 'Forge 화면에 넘기는 임시 글 (화면 상태)',
  'hx-sidebar-collapsed': '사이드바에서 접어 둔 프로젝트 묶음 (화면 상태)',
};

/** 앞으로 다른 구역이 쓸 이름공간 (등록 전에 쓰면 바로 걸리도록) */
export const RESERVED_NAMESPACES = [
  'mode',
  'main',
  'attachments',
  'checklist',
  'approval',
  'project',
  'data',
];

export function settingNamespaces(registry: SettingsRegistry = settingsRegistry): string[] {
  return [...new Set([...registry.keys().map((k) => k.split('.')[0]!), ...RESERVED_NAMESPACES])];
}

/** 'engines.json' 같은 파일 이름은 키가 아니다 */
const FILE_EXT_RE = /\.(json|ya?ml|tsx?|jsx?|md|lock|txt|log)$/;

/** 화면 동작 id(`act('engines.rescan')`, T-101 0C.1)는 설정 키가 아니다 — 바로 앞이 act( / actionAttr( 이면 건너뛴다 */
const ACTION_ARG_RE = /\b(?:act|actionAttr)\(\s*$/;

const lineOf = (text: string, idx: number) => text.slice(0, idx).split('\n').length;

/** 소스 글 하나에서 설정 키 사용 찾기 */
export function scanSourceText(
  file: string,
  text: string,
  namespaces: readonly string[] = settingNamespaces(),
): CodeKeyHit[] {
  const hits: CodeKeyHit[] = [];
  const RS = /readSetting(?:<[^>]*>)?\(\s*[^,()]+(?:\([^)]*\))?\s*,\s*['"`]([a-zA-Z][\w.-]*)['"`]/g;
  for (const m of text.matchAll(RS))
    hits.push({ key: m[1]!, file, line: lineOf(text, m.index), how: 'readSetting' });
  if (/settings\.json|SETTINGS_FILE/.test(text) || /settings?[^/\\]*\.tsx?$/i.test(file)) {
    const ns = namespaces.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    const LIT = new RegExp(`['"\`]((?:${ns})(?:\\.[a-zA-Z][a-zA-Z0-9]*)+)['"\`]`, 'g');
    for (const m of text.matchAll(LIT))
      if (!FILE_EXT_RE.test(m[1]!) && !ACTION_ARG_RE.test(text.slice(Math.max(0, m.index - 40), m.index)))
        hits.push({ key: m[1]!, file, line: lineOf(text, m.index), how: 'literal' });
  }
  const BK = /[A-Z_]*KEY\s*=\s*['"`](hx[.-][^'"`]+)['"`]/g;
  for (const m of text.matchAll(BK))
    hits.push({ key: m[1]!, file, line: lineOf(text, m.index), how: 'browser' });
  // 같은 줄의 같은 키는 한 번만 (readSetting 호출이 글자 검사에도 걸리는 경우)
  const seen = new Set<string>();
  return hits.filter((h) => {
    const id = `${h.key}:${h.line}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

const SKIP_DIRS = new Set(['node_modules', 'dist', 'test', 'tests', '__snapshots__', 'target', '.git']);

/** 폴더 아래 .ts/.tsx 소스(테스트 제외)를 모두 검사 */
export function scanSourceTree(
  roots: readonly string[],
  base: string,
  namespaces: readonly string[] = settingNamespaces(),
): CodeKeyHit[] {
  const out: CodeKeyHit[] = [];
  const walk = (dir: string) => {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const n of names) {
      const p = join(dir, n);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (!SKIP_DIRS.has(n) && !n.startsWith('.')) walk(p);
      } else if (/\.tsx?$/.test(n) && !/\.(test|d)\.tsx?$/.test(n))
        out.push(...scanSourceText(relative(base, p), readFileSync(p, 'utf8'), namespaces));
    }
  };
  for (const r of roots) walk(r);
  return out;
}

/** Zod 객체 스키마의 잎 키를 '<prefix>.<이름>' 모양으로 펼친다 */
export function schemaKeys(prefix: string, schema: z.ZodType): string[] {
  const unwrap = (s: z.ZodType): z.ZodType => {
    let cur = s as z.ZodType & { def?: { innerType?: z.ZodType; in?: z.ZodType; type?: string } };
    for (let i = 0; i < 10; i++) {
      const d = cur.def;
      if (d?.innerType) cur = d.innerType as typeof cur;
      else if (d?.type === 'pipe' && d.in) cur = d.in as typeof cur;
      else break;
    }
    return cur;
  };
  const s = unwrap(schema) as z.ZodType & { shape?: Record<string, z.ZodType> };
  if (!s.shape) return [prefix];
  return Object.entries(s.shape).flatMap(([k, v]) => schemaKeys(`${prefix}.${k}`, v));
}

/** 레지스트리에 없는(또는 브라우저 키로 등록되지 않은) 사용 */
export function unregisteredHits(
  hits: readonly CodeKeyHit[],
  registry: SettingsRegistry = settingsRegistry,
): CodeKeyHit[] {
  const browserKeys = new Set(registry.list().flatMap((d) => (d.browserKey ? [d.browserKey] : [])));
  return hits.filter((h) => {
    if (h.how === 'browser') return !browserKeys.has(h.key) && !(h.key in NOT_SETTING_BROWSER_KEYS);
    if (h.key in NOT_SETTING_KEYS) return false;
    return !registry.has(h.key);
  });
}
