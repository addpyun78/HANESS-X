import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { harnessHome } from '../loader.js';
import {
  deletePath,
  getPath,
  setPath,
  settingsRegistry,
  SettingValueError,
  type SettingDef,
  type SettingGroupId,
  type SettingsRegistry,
} from './registry.js';

/**
 * T-101 0A.7·0A.8 설정 저장소
 *  - 전체 값: ~/.harness-x/settings.json (중첩 객체, judge·builder·tools가 이미 읽는 파일)
 *  - 프로젝트 값: 0-2가 만드는 <프로젝트>/.harness-x/project.json — 여기서는 주입받는 ProjectSettingsIO로만 다룬다
 *  - 실제 값 = (scope가 project|both이고 프로젝트 값이 있으면) 프로젝트 값 > 전체 값 > 기본값
 *  - 저장 전 레지스트리 스키마로 검사, 잘못된 값은 쉬운 말 SettingValueError로 거부
 *  - 저장하면 바로 구독자에게 알린다(즉시 적용). restartRequired 키는 "다시 시작하면 적용돼요"
 */

export const SETTINGS_FILE = 'settings.json';
export const RESTART_NOTICE = '다시 시작하면 적용돼요.';

/** 0-2 프로젝트 설정 읽기/쓰기 (프로젝트 id → settings.json과 같은 중첩 객체) */
export interface ProjectSettingsIO {
  read(projectId: string): Record<string, unknown>;
  write(projectId: string, values: Record<string, unknown>): void;
}

/** 키체인 (kernel SecretStore와 호환) */
export interface SettingsSecrets {
  get(account: string): string | null;
  set(account: string, value: string): void;
  delete(account: string): boolean;
}

export type SaveScope = 'global' | 'project';
export type ValueSource = 'default' | 'global' | 'project';

export interface SettingValueState {
  effective: unknown;
  source: ValueSource;
  global?: unknown;
  project?: unknown;
  /** 파일에 들어 있는 값이 잘못돼 기본값을 쓰는 중이면 쉬운 말 이유 */
  invalid?: string;
  /** 키체인 값이면 가린 값(없으면 null) */
  masked?: string | null;
}

export interface SettingsChange {
  key: string;
  scope: SaveScope;
  projectId?: string;
  /** undefined = 지움(기본값으로) */
  value: unknown;
}

export interface SaveResult {
  ok: true;
  key: string;
  state: SettingValueState;
  restartRequired: boolean;
  notice?: string;
}

export type ResetTarget = { key: string } | { group: SettingGroupId | string } | { all: true };

export interface SettingsStoreOptions {
  /** 기본 ~/.harness-x/settings.json */
  file?: string;
  /** 기본 settingsRegistry. 함수면 매번 새로 받는다(플러그인 설정 반영) */
  registry?: SettingsRegistry | (() => SettingsRegistry);
  project?: ProjectSettingsIO;
  secrets?: SettingsSecrets;
  /** storage 'engines-file' 값 (엔진 화면 API가 저장) */
  engines?: () => unknown;
}

export function defaultSettingsFile(): string {
  return join(harnessHome(), SETTINGS_FILE);
}

/** 키 표시용 마스킹: 끝 4자만 (12자 미만이면 전부 가림) — engines-routes maskApiKey와 같은 규칙 */
export function maskSecret(v: string): string {
  return v.length >= 12 ? `••••${v.slice(-4)}` : '••••';
}

export class SettingsStore {
  readonly file: string;
  private readonly reg: () => SettingsRegistry;
  private readonly listeners = new Set<(c: SettingsChange[]) => void>();

  constructor(private readonly o: SettingsStoreOptions = {}) {
    this.file = o.file ?? defaultSettingsFile();
    const r = o.registry ?? settingsRegistry;
    this.reg = typeof r === 'function' ? r : () => r;
  }

  get registry(): SettingsRegistry {
    return this.reg();
  }

  /** settings.json 원본 (없거나 깨졌으면 {}) */
  readGlobal(): Record<string, unknown> {
    try {
      if (!existsSync(this.file)) return {};
      const v = JSON.parse(readFileSync(this.file, 'utf8')) as unknown;
      return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }

  private writeGlobal(values: Record<string, unknown>): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(values, null, 2) + '\n');
    renameSync(tmp, this.file);
  }

  private readProject(projectId: string | undefined): Record<string, unknown> {
    if (!projectId || !this.o.project) return {};
    try {
      return this.o.project.read(projectId) ?? {};
    } catch {
      return {};
    }
  }

  /** 변경 구독 (즉시 적용용). 돌려준 함수로 끊는다 */
  subscribe(fn: (changes: SettingsChange[]) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(changes: SettingsChange[]): void {
    if (changes.length) for (const fn of this.listeners) fn(changes);
  }

  private stateOf(
    d: SettingDef,
    g: Record<string, unknown>,
    p: Record<string, unknown>,
    reg: SettingsRegistry,
  ): SettingValueState {
    const storage = d.storage ?? 'settings';
    const dflt = reg.defaultOf(d.key);
    if (storage === 'keychain') {
      let v: string | null = null;
      try {
        v = this.o.secrets?.get(d.secretAccount!) ?? null;
      } catch {
        v = null;
      }
      return { effective: null, source: v ? 'global' : 'default', masked: v ? maskSecret(v) : null };
    }
    if (storage === 'browser') return { effective: dflt, source: 'default' };
    if (storage === 'engines-file') {
      let v: unknown;
      try {
        v = this.o.engines?.();
      } catch {
        v = undefined;
      }
      const r = v === undefined ? undefined : reg.check(d.key, v);
      return r?.ok
        ? { effective: r.value, source: 'global', global: v }
        : { effective: dflt, source: 'default' };
    }
    const gv = getPath(g, d.path);
    const pv = d.scope === 'global' ? undefined : getPath(p, d.path);
    const st: SettingValueState = { effective: dflt, source: 'default' };
    if (gv !== undefined) st.global = gv;
    if (pv !== undefined) st.project = pv;
    const order: [ValueSource, unknown][] = [];
    if (pv !== undefined) order.push(['project', pv]);
    if (gv !== undefined && d.scope !== 'project') order.push(['global', gv]);
    for (const [src, v] of order) {
      const r = reg.check(d.key, v);
      if (r.ok) return { ...st, effective: r.value, source: src };
      st.invalid ??= r.message;
    }
    return st;
  }

  /** 모든 키의 현재 상태 */
  snapshot(projectId?: string): Record<string, SettingValueState> {
    const reg = this.reg();
    const g = this.readGlobal();
    const p = this.readProject(projectId);
    return Object.fromEntries(reg.list().map((d) => [d.key, this.stateOf(d, g, p, reg)]));
  }

  /** 실제로 쓰일 값만 (key → 값) */
  effective(projectId?: string): Record<string, unknown> {
    return Object.fromEntries(Object.entries(this.snapshot(projectId)).map(([k, s]) => [k, s.effective]));
  }

  private def(key: string): SettingDef {
    const d = this.reg().get(key);
    if (!d) throw new SettingValueError(key, '알 수 없는 설정이에요.');
    return d;
  }

  private checkScope(d: SettingDef, scope: SaveScope, projectId?: string): void {
    if (scope === 'project') {
      if (d.scope === 'global') throw new SettingValueError(d.key, '이 설정은 전체에만 적용돼요.');
      if (!projectId) throw new SettingValueError(d.key, '프로젝트를 먼저 골라 주세요.');
      if (!this.o.project) throw new SettingValueError(d.key, '프로젝트 설정을 아직 쓸 수 없어요.');
    } else if (d.scope === 'project')
      throw new SettingValueError(d.key, '이 설정은 프로젝트마다 따로 정해요.');
  }

  private checkStorage(d: SettingDef): void {
    const s = d.storage ?? 'settings';
    if (s === 'engines-file') throw new SettingValueError(d.key, '엔진 화면에서 바꿔 주세요.');
    if (s === 'browser') throw new SettingValueError(d.key, '이 설정은 이 기기 화면에만 저장돼요.');
    if (s === 'keychain') throw new SettingValueError(d.key, '키는 키 입력 칸에서 저장해 주세요.');
  }

  private result(d: SettingDef, projectId?: string): SaveResult {
    const reg = this.reg();
    const state = this.stateOf(d, this.readGlobal(), this.readProject(projectId), reg);
    return {
      ok: true,
      key: d.key,
      state,
      restartRequired: d.restartRequired,
      ...(d.restartRequired ? { notice: RESTART_NOTICE } : {}),
    };
  }

  /** 값 저장. 잘못된 값이면 SettingValueError(쉬운 말) — 파일은 바뀌지 않는다 */
  set(key: string, value: unknown, opts: { scope?: SaveScope; projectId?: string } = {}): SaveResult {
    const d = this.def(key);
    const scope = opts.scope ?? 'global';
    this.checkStorage(d);
    this.checkScope(d, scope, opts.projectId);
    const parsed = this.reg().parse(key, value);
    if (scope === 'project') {
      const io = this.o.project!;
      io.write(opts.projectId!, setPath(this.readProject(opts.projectId), d.path, parsed));
    } else this.writeGlobal(setPath(this.readGlobal(), d.path, parsed));
    this.emit([{ key, scope, value: parsed, ...(opts.projectId ? { projectId: opts.projectId } : {}) }]);
    return this.result(d, opts.projectId);
  }

  /** 0A.8 되돌리기: 항목 하나 / 그룹(섹션) / 전체를 기본값으로 (저장된 값을 지운다). 지운 키 목록 */
  reset(target: ResetTarget, opts: { scope?: SaveScope; projectId?: string } = {}): string[] {
    const reg = this.reg();
    const scope = opts.scope ?? 'global';
    const defs =
      'key' in target
        ? [this.def(target.key)]
        : 'group' in target
          ? reg.byGroup(target.group as SettingGroupId)
          : reg.list();
    const targets = defs.filter(
      (d) =>
        (d.storage ?? 'settings') === 'settings' &&
        (scope === 'project' ? d.scope !== 'global' : d.scope !== 'project'),
    );
    if (scope === 'project') {
      if (!opts.projectId || !this.o.project) return [];
      let p = this.readProject(opts.projectId);
      const done = targets.filter((d) => getPath(p, d.path) !== undefined);
      for (const d of done) p = deletePath(p, d.path);
      if (done.length) this.o.project.write(opts.projectId, p);
      this.emit(done.map((d) => ({ key: d.key, scope, projectId: opts.projectId!, value: undefined })));
      return done.map((d) => d.key);
    }
    let g = this.readGlobal();
    const done = targets.filter((d) => getPath(g, d.path) !== undefined);
    for (const d of done) g = deletePath(g, d.path);
    if (done.length) this.writeGlobal(g);
    this.emit(done.map((d) => ({ key: d.key, scope, value: undefined })));
    return done.map((d) => d.key);
  }

  /** 키 입력기: 키체인에 저장하고 가린 값만 돌려준다 */
  setSecret(key: string, value: string): { masked: string } {
    const d = this.def(key);
    if (d.storage !== 'keychain' || !d.secretAccount)
      throw new SettingValueError(key, '키를 넣는 설정이 아니에요.');
    if (!this.o.secrets) throw new SettingValueError(key, '키 보관함을 쓸 수 없어요.');
    const v = value.trim();
    const r = this.reg().check(key, v);
    if (!r.ok) throw new SettingValueError(key, v ? r.message : '키를 넣어 주세요.');
    this.o.secrets.set(d.secretAccount, v);
    this.emit([{ key, scope: 'global', value: '(키)' }]);
    return { masked: maskSecret(v) };
  }

  deleteSecret(key: string): boolean {
    const d = this.def(key);
    if (d.storage !== 'keychain' || !d.secretAccount || !this.o.secrets) return false;
    const ok = this.o.secrets.delete(d.secretAccount);
    this.emit([{ key, scope: 'global', value: undefined }]);
    return ok;
  }
}
