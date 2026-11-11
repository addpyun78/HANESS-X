import { parse, stringify } from 'yaml';
import { getPath, setPath, type SettingDef } from './registry.js';
import type { SettingsStore } from './store.js';

/**
 * T-101 6C.3 설정 내보내기/가져오기 `settings.yaml`
 *  - 내보내기: settings.json에 저장된 전체 값 중 레지스트리에 등록된 키만 (키체인·브라우저·엔진 묶음·프로젝트 값 제외)
 *  - 가져오기: 모든 값을 먼저 검사하고, 하나라도 틀리면 아무것도 바꾸지 않는다(쉬운 말 오류 목록).
 *    모르는 키·키(비밀) 칸은 거부한다.
 */

export const EXPORT_HEADER = '# HARNESS-X 설정 파일 — 키(비밀 값)는 들어 있지 않아요.\n';

const exportable = (d: SettingDef) => (d.storage ?? 'settings') === 'settings' && d.scope !== 'project';

export function exportSettingsYaml(store: SettingsStore): string {
  const g = store.readGlobal();
  let out: Record<string, unknown> = {};
  for (const d of store.registry.list()) {
    if (!exportable(d)) continue;
    const v = getPath(g, d.path);
    if (v !== undefined && store.registry.check(d.key, v).ok) out = setPath(out, d.path, v);
  }
  return EXPORT_HEADER + (Object.keys(out).length ? stringify(out) : '{}\n');
}

export interface ImportIssue {
  key: string;
  message: string;
}

export type ImportResult = { ok: true; imported: string[] } | { ok: false; issues: ImportIssue[] };

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** 잎 경로 목록 (등록 키 경로에 닿으면 거기서 멈춤) */
function leaves(obj: unknown, prefix: string[], stops: Set<string>): string[][] {
  if (stops.has(prefix.join('.')) || !isObj(obj)) return prefix.length ? [prefix] : [];
  const keys = Object.keys(obj);
  if (keys.length === 0) return prefix.length ? [prefix] : [];
  return keys.flatMap((k) => leaves(obj[k], [...prefix, k], stops));
}

export function importSettingsYaml(store: SettingsStore, text: string): ImportResult {
  let data: unknown;
  try {
    data = parse(text) ?? {};
  } catch {
    return {
      ok: false,
      issues: [{ key: '', message: '설정 파일 모양이 맞지 않아요. 내보낸 파일을 그대로 넣어 주세요.' }],
    };
  }
  if (!isObj(data))
    return {
      ok: false,
      issues: [{ key: '', message: '설정 파일 모양이 맞지 않아요. 내보낸 파일을 그대로 넣어 주세요.' }],
    };
  const reg = store.registry;
  const defs = reg.list();
  const byPath = new Map(defs.map((d) => [d.path.join('.'), d]));
  const issues: ImportIssue[] = [];
  const values: [SettingDef, unknown][] = [];
  for (const p of leaves(data, [], new Set(byPath.keys()))) {
    const d = byPath.get(p.join('.'));
    const key = d?.key ?? p.join('.');
    if (!d) issues.push({ key, message: '알 수 없는 설정이에요.' });
    else if ((d.storage ?? 'settings') === 'keychain')
      issues.push({ key, message: '키는 가져올 수 없어요. 키 입력 칸에서 넣어 주세요.' });
    else if (!exportable(d)) issues.push({ key, message: '이 설정은 파일로 가져올 수 없어요.' });
    else {
      const r = reg.check(d.key, getPath(data, d.path));
      if (r.ok) values.push([d, r.value]);
      else issues.push({ key, message: r.message });
    }
  }
  if (issues.length) return { ok: false, issues };
  for (const [d, v] of values) store.set(d.key, v);
  return { ok: true, imported: values.map(([d]) => d.key) };
}
