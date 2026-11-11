import { z } from 'zod';
import { EngineSettingSchema } from '../engines-settings.js';

/**
 * T-101 0-1 설정 레지스트리 — 하네스의 모든 설정 키를 한 곳에 Zod 스키마 + 메타로 등록한다.
 * 설정 화면(apps/web/src/settings/form)은 이 목록을 보고 자동으로 그려지고, 재발 방지 검사(0A.10)는
 * "코드에서 읽는 키 ⊆ 여기 등록된 키"를 확인한다.
 *
 * ▶ 새 설정 키 등록 방법 (다른 구역 작업자용): 아래 `CORE_SETTINGS` 배열의 알맞은 그룹 자리에
 * `defineSetting('<그룹>.<이름>', z.<형식>().default(<기본값>), { group, title, description, advanced,
 * restartRequired, scope, widget?, options? })` 한 줄을 추가한다. 키는 `settings.json` 안의 중첩 경로
 * (예: 키 mode.default → { mode: { default } })이고, 스키마에는 반드시 `.default()`를 붙인다(되돌리기에 씀).
 * title·description은 쉬운 말(존댓말, 개발 용어 금지 — approvals `checkPlainKorean` 통과)로 쓰고, 선택지
 * (enum)는 `options`에 화면 이름을 단다. 값을 읽는 코드는 `readSetting(values, '<키>')`를 쓰면 0A.10 검사가
 * 자동으로 찾는다. `scope`는 global(전체만) | project(프로젝트만) | both(프로젝트 값이 있으면 전체 값보다 우선).
 * 시작할 때 한 번만 읽는 값이면 `restartRequired: true`. 등록 후 `pnpm exec vitest run tests/settings-coverage.test.ts`.
 */

// ── 그룹 (설정 화면 섹션 순서) ─────────────────────────────────

export const SETTING_GROUPS = [
  { id: 'general', title: '일반', description: '화면 모양처럼 자주 바꾸는 설정이에요.' },
  { id: 'ai', title: 'AI·엔진', description: '어떤 AI를 쓸지 고르는 설정이에요.' },
  { id: 'mode', title: '모드·권한', description: '계획·일반·오토 모드와 허락 범위를 정해요.' },
  { id: 'checklist', title: '체크리스트', description: '단계별 체크리스트가 움직이는 방식을 정해요.' },
  { id: 'judge', title: '판정', description: '결과가 맞는지 확인하는 방법을 정해요.' },
  { id: 'approval', title: '승인·알림', description: '허락을 묻는 방법과 알림을 정해요.' },
  { id: 'tools', title: '도구·설치', description: '필요한 도구를 찾고 설치하는 방법을 정해요.' },
  { id: 'attachments', title: '첨부', description: '입력창에 붙이는 파일의 한도를 정해요.' },
  { id: 'voice', title: '음성', description: '말로 입력하는 방법을 정해요.' },
  { id: 'project', title: '프로젝트', description: '프로젝트 목록과 기본값을 정해요.' },
  { id: 'data', title: '데이터·보안', description: '기록 보관과 비밀 키를 관리해요.' },
  { id: 'plugins', title: '플러그인', description: '설치한 플러그인마다 따로 정하는 설정이에요.' },
  { id: 'about', title: '정보', description: '버전과 도움말을 볼 수 있어요.' },
] as const satisfies readonly { id: string; title: string; description: string }[];

export type SettingGroupId = (typeof SETTING_GROUPS)[number]['id'];
export const SETTING_GROUP_IDS: readonly SettingGroupId[] = SETTING_GROUPS.map((g) => g.id);

// ── 메타 ─────────────────────────────────────────────────────

/** 값이 어디에 적용되나: 전체 / 프로젝트 / 둘 다(프로젝트 값이 전체 값보다 우선) */
export type SettingScope = 'global' | 'project' | 'both';

/** 화면 위젯. 생략하면 스키마 형식에서 고른다(boolean·enum·number·string·array) */
export type SettingWidget =
  | 'boolean'
  | 'enum'
  | 'number'
  | 'string'
  | 'array'
  /** 엔진 고르기 (빈 값 = 자동) */
  | 'engine'
  /** 모델 고르기 (meta.engineKey의 엔진 기준) */
  | 'model'
  /** 키 입력기: 값은 키체인(meta.secretAccount)에만, 화면에는 가린 값 */
  | 'secret'
  /** 폴더 고르기 (T-034 폴더 대화상자) */
  | 'folder'
  /** 엔진별 인증·모델 묶음 (engines-settings.yaml, 설정 > 엔진 화면) */
  | 'engine-settings';

/** 값이 저장되는 곳 */
export type SettingStorage =
  /** ~/.harness-x/settings.json (프로젝트 범위는 <프로젝트>/.harness-x/project.json) */
  | 'settings'
  /** ~/.harness-x/engines-settings.yaml (엔진 화면 API가 관리) */
  | 'engines-file'
  /** OS 키체인 */
  | 'keychain'
  /** 브라우저 저장소 (이 기기 화면에만) */
  | 'browser';

export interface SettingMeta {
  group: SettingGroupId;
  /** 쉬운 말 제목 */
  title: string;
  /** 쉬운 말 설명 (존댓말 문장) */
  description: string;
  /** true면 "고급 설정 보기"를 켰을 때만 보임 */
  advanced: boolean;
  /** true면 저장 후 "다시 시작하면 적용돼요" 표시 */
  restartRequired: boolean;
  scope: SettingScope;
  widget?: SettingWidget;
  /** 기본 'settings' */
  storage?: SettingStorage;
  /** enum 값 → 화면 이름 */
  options?: Readonly<Record<string, string>>;
  /** storage 'keychain'의 계정 이름 */
  secretAccount?: string;
  /** storage 'browser'의 저장 이름 */
  browserKey?: string;
  /** widget 'model'이 따르는 엔진 키 */
  engineKey?: string;
  /** 플러그인 설정이면 플러그인 id·이름 (0A.9) */
  plugin?: { id: string; title: string };
}

export interface SettingDef<S extends z.ZodType = z.ZodType> extends SettingMeta {
  key: string;
  /** settings.json 안의 경로 (보통 key를 '.'로 나눈 것) */
  path: readonly string[];
  schema: S;
}

const KEY_RE = /^[a-z][a-zA-Z0-9-]*(\.[a-zA-Z0-9][a-zA-Z0-9_-]*)*$/;

export function defineSetting<S extends z.ZodType>(
  key: string,
  schema: S,
  meta: SettingMeta & { path?: readonly string[] },
): SettingDef<S> {
  const { path, ...rest } = meta;
  return { ...rest, key, path: path ?? key.split('.'), schema };
}

export class SettingRegistrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SettingRegistrationError';
  }
}

// ── 쉬운 말 오류 (0A.7) ───────────────────────────────────────

/** Zod 오류 하나 → 화면에 보일 쉬운 말 */
export function plainIssue(issue: z.core.$ZodIssue): string {
  const i = issue as z.core.$ZodIssue & {
    expected?: string;
    minimum?: number | bigint;
    maximum?: number | bigint;
    origin?: string;
    format?: string;
  };
  switch (i.code) {
    case 'invalid_type':
      if (i.expected === 'number' || i.expected === 'int') return '숫자를 넣어 주세요.';
      if (i.expected === 'boolean') return '켜기나 끄기 중에서 골라 주세요.';
      if (i.expected === 'array') return '목록으로 넣어 주세요.';
      if (i.expected === 'string') return '글자로 넣어 주세요.';
      return '이 값은 쓸 수 없어요.';
    case 'too_small':
      if (i.origin === 'string') return '비워 둘 수 없어요.';
      if (i.origin === 'array') return `${String(i.minimum)}개 이상 넣어 주세요.`;
      return `${String(i.minimum)} 이상으로 넣어 주세요.`;
    case 'too_big':
      if (i.origin === 'string') return `${String(i.maximum)}자 이하로 줄여 주세요.`;
      if (i.origin === 'array') return `${String(i.maximum)}개까지만 넣을 수 있어요.`;
      return `${String(i.maximum)} 이하로 넣어 주세요.`;
    case 'invalid_value':
      return '보기에 있는 값 중에서 골라 주세요.';
    case 'invalid_format':
      return i.format === 'url' ? '주소 모양이 맞지 않아요.' : '모양이 맞지 않아요.';
    case 'not_multiple_of':
      return '소수점 없는 숫자로 넣어 주세요.';
    default:
      return '이 값은 쓸 수 없어요.';
  }
}

export type SettingCheck = { ok: true; value: unknown } | { ok: false; message: string };

/** 잘못된 값 저장 거부용 오류 (message는 쉬운 말) */
export class SettingValueError extends Error {
  readonly code = 'SETTING_INVALID';
  constructor(
    readonly key: string,
    message: string,
  ) {
    super(message);
    this.name = 'SettingValueError';
  }
}

// ── 레지스트리 ───────────────────────────────────────────────

export class SettingsRegistry {
  private readonly defs = new Map<string, SettingDef>();

  constructor(defs: readonly SettingDef[] = []) {
    for (const d of defs) this.register(d);
  }

  register(def: SettingDef): this {
    if (!KEY_RE.test(def.key)) throw new SettingRegistrationError(`설정 키 형식이 잘못됨: '${def.key}'`);
    if (this.defs.has(def.key)) throw new SettingRegistrationError(`설정 키 중복: '${def.key}'`);
    if (!SETTING_GROUP_IDS.includes(def.group))
      throw new SettingRegistrationError(`없는 그룹 '${def.group}' (키 '${def.key}')`);
    const p = def.path.join('\u0000');
    for (const o of this.defs.values()) {
      const q = o.path.join('\u0000');
      if (p.startsWith(q + '\u0000') || q.startsWith(p + '\u0000'))
        throw new SettingRegistrationError(`설정 키 '${def.key}'와 '${o.key}'의 경로가 겹침`);
    }
    if ((def.storage ?? 'settings') === 'keychain' && !def.secretAccount)
      throw new SettingRegistrationError(`키체인 설정 '${def.key}'에 secretAccount가 없음`);
    if (def.storage === 'browser' && !def.browserKey)
      throw new SettingRegistrationError(`브라우저 설정 '${def.key}'에 browserKey가 없음`);
    this.defs.set(def.key, def);
    return this;
  }

  /** 복사본 (플러그인 설정을 덧붙일 때) */
  clone(): SettingsRegistry {
    return new SettingsRegistry([...this.defs.values()]);
  }

  has(key: string): boolean {
    return this.defs.has(key);
  }
  get(key: string): SettingDef | undefined {
    return this.defs.get(key);
  }
  keys(): string[] {
    return [...this.defs.keys()];
  }
  list(): SettingDef[] {
    return [...this.defs.values()];
  }
  byGroup(group: SettingGroupId): SettingDef[] {
    return this.list().filter((d) => d.group === group);
  }

  /** 기본값 (스키마의 .default) — 없으면 undefined */
  defaultOf(key: string): unknown {
    const d = this.defs.get(key);
    if (!d) return undefined;
    const r = d.schema.safeParse(undefined);
    return r.success ? r.data : undefined;
  }

  /** 값 검사. 실패하면 쉬운 말 메시지 */
  check(key: string, value: unknown): SettingCheck {
    const d = this.defs.get(key);
    if (!d) return { ok: false, message: '알 수 없는 설정이에요.' };
    const r = d.schema.safeParse(value);
    if (r.success) return { ok: true, value: r.data };
    return { ok: false, message: plainIssue(r.error.issues[0]!) };
  }

  /** check와 같지만 실패하면 SettingValueError */
  parse(key: string, value: unknown): unknown {
    const r = this.check(key, value);
    if (!r.ok) throw new SettingValueError(key, r.message);
    return r.value;
  }
}

// ── 중첩 객체 경로 도우미 ─────────────────────────────────────

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export function getPath(obj: unknown, path: readonly string[]): unknown {
  let cur: unknown = obj;
  for (const p of path) {
    if (!isObj(cur) || !(p in cur)) return undefined;
    cur = cur[p];
  }
  return cur;
}

/** 새 객체를 돌려준다 (입력은 바꾸지 않음) */
export function setPath(obj: Record<string, unknown>, path: readonly string[], value: unknown) {
  const out: Record<string, unknown> = { ...obj };
  let cur = out;
  path.forEach((p, i) => {
    if (i === path.length - 1) cur[p] = value;
    else {
      const next = isObj(cur[p]) ? { ...(cur[p] as Record<string, unknown>) } : {};
      cur[p] = next;
      cur = next;
    }
  });
  return out;
}

/** 경로의 값을 지우고 비게 된 부모 객체도 지운다 (새 객체) */
export function deletePath(obj: Record<string, unknown>, path: readonly string[]): Record<string, unknown> {
  const [head, ...rest] = path;
  if (head === undefined || !(head in obj)) return obj;
  const out = { ...obj };
  if (rest.length === 0) delete out[head];
  else if (isObj(out[head])) {
    const child = deletePath(out[head] as Record<string, unknown>, rest);
    if (Object.keys(child).length === 0) delete out[head];
    else out[head] = child;
  }
  return out;
}

// ── 코드에서 설정 읽기 ───────────────────────────────────────

/**
 * 설정 값 읽기 (없거나 잘못되면 기본값). 0A.10 검사가 `readSetting(…, '<키>')` 호출을 찾아
 * 레지스트리에 등록됐는지 확인하므로, 새 코드는 이 함수로 읽는다.
 */
export function readSetting<T = unknown>(
  values: Record<string, unknown>,
  key: string,
  registry: SettingsRegistry = settingsRegistry,
): T {
  const d = registry.get(key);
  if (!d) throw new SettingRegistrationError(`등록되지 않은 설정 키: '${key}'`);
  const r = d.schema.safeParse(getPath(values, d.path));
  return (r.success ? r.data : registry.defaultOf(key)) as T;
}

// ── 기본 등록 키 (0A.3 — docs/tickets/T-101-settings-keys.md) ────────

const engineId = z.string().default('');
const S = (s = '') => z.string().default(s);

export const CORE_SETTINGS: readonly SettingDef[] = [
  // ── 일반
  defineSetting('ui.theme', z.enum(['system', 'light', 'dark']).default('system'), {
    group: 'general',
    title: '화면 테마',
    description: '밝은 화면과 어두운 화면 중에서 골라요. 이 기기 화면에만 저장돼요.',
    advanced: false,
    restartRequired: false,
    scope: 'global',
    storage: 'browser',
    browserKey: 'hx-theme',
    options: { system: '컴퓨터 설정 따르기', light: '밝게', dark: '어둡게' },
  }),

  // ── AI·엔진
  defineSetting('engines', z.record(z.string(), EngineSettingSchema).default({}), {
    group: 'ai',
    title: '엔진별 로그인과 모델',
    description: '엔진마다 월정액 로그인이나 키 사용을 고르고 모델을 정해요.',
    advanced: false,
    restartRequired: false,
    scope: 'global',
    storage: 'engines-file',
    widget: 'engine-settings',
  }),
  // T-101 5C.3 메인 AI: 입력창 오른쪽 아래 [엔진 · 모델 ▾]에서 고른 것 (kernel main-ai.ts가 읽고 쓴다)
  defineSetting('main.engine', engineId, {
    group: 'ai',
    title: '기본으로 쓰는 AI',
    description: '새 대화와 "자동"으로 둔 기능이 쓰는 AI예요. 입력창 오른쪽 아래에서도 바꿀 수 있어요.',
    advanced: false,
    restartRequired: false,
    scope: 'global',
    widget: 'engine',
  }),
  defineSetting('main.model', S(), {
    group: 'ai',
    title: '기본으로 쓰는 AI의 모델',
    description: '메인 AI가 쓸 모델이에요. 비우면 그 AI의 기본 모델을 써요.',
    advanced: false,
    restartRequired: false,
    scope: 'global',
    widget: 'model',
    engineKey: 'main.engine',
  }),
  defineSetting('builder.engine', engineId, {
    group: 'ai',
    title: '에이전트 설계에 쓸 AI',
    description: '대화로 에이전트를 만들 때 쓸 AI예요. 비우면 기본 AI를 써요.',
    advanced: false,
    restartRequired: false,
    scope: 'global',
    widget: 'engine',
  }),
  defineSetting('builder.maxQuestions', z.number().int().min(0).max(3).default(3), {
    group: 'ai',
    title: '되묻는 질문 수',
    description: '에이전트를 만들 때 AI가 되물을 수 있는 질문 수예요.',
    advanced: true,
    restartRequired: false,
    scope: 'global',
  }),
  defineSetting('builder.animation', z.boolean().default(true), {
    group: 'ai',
    title: '초안 조립 움직임',
    description: '에이전트 초안이 하나씩 맞춰지는 움직임을 보여 줘요.',
    advanced: true,
    restartRequired: false,
    scope: 'global',
  }),

  // ── 판정
  defineSetting('judge.engine', engineId, {
    group: 'judge',
    title: '판정할 때 쓸 AI',
    description: '결과가 맞는지 따져 볼 AI예요. 비우면 알아서 골라요.',
    advanced: false,
    restartRequired: true,
    scope: 'global',
    widget: 'engine',
  }),
  defineSetting('judge.model', S(), {
    group: 'judge',
    title: '판정에 쓸 모델',
    description: '판정 AI가 쓸 모델이에요. 비우면 그 AI의 기본 모델을 써요.',
    advanced: true,
    restartRequired: true,
    scope: 'global',
    widget: 'model',
    engineKey: 'judge.engine',
  }),
  defineSetting('judge.samples', z.number().int().min(1).max(3).default(3), {
    group: 'judge',
    title: '여러 번 물어보기',
    description: '같은 판정을 몇 번 물어서 많은 쪽을 따를지 정해요.',
    advanced: true,
    restartRequired: true,
    scope: 'global',
  }),
  defineSetting('judge.maxCallsPerSession', z.number().int().min(0).default(50), {
    group: 'judge',
    title: '작업 한 번의 판정 한도',
    description: '작업 하나에서 판정 AI를 부를 수 있는 최대 횟수예요.',
    advanced: true,
    restartRequired: true,
    scope: 'global',
  }),
  defineSetting('judge.semantic', z.enum(['on', 'off']).default('on'), {
    group: 'judge',
    title: '뜻으로 판정하기',
    description: '글자가 달라도 뜻이 같으면 맞다고 볼지 정해요.',
    advanced: false,
    restartRequired: true,
    scope: 'global',
    options: { on: '켜기', off: '끄기' },
  }),
  defineSetting('judge.local.model', S(), {
    group: 'judge',
    title: '내 컴퓨터 판정 모델',
    description: '내 컴퓨터에서 도는 판정 모델 이름이에요. 비우면 알아서 골라요.',
    advanced: true,
    restartRequired: true,
    scope: 'global',
  }),
  defineSetting('judge.local.timeoutMs', z.number().int().min(1000).max(600_000).default(20_000), {
    group: 'judge',
    title: '내 컴퓨터 판정 기다림(밀리초)',
    description: '내 컴퓨터 판정이 이 시간보다 오래 걸리면 멈춰요.',
    advanced: true,
    restartRequired: true,
    scope: 'global',
  }),
  defineSetting('verifier.local.baseUrl', S(), {
    group: 'judge',
    title: '내 컴퓨터 판정기 주소',
    description: '내 컴퓨터 판정기가 열려 있는 주소예요. 비우면 기본 주소를 써요.',
    advanced: true,
    restartRequired: true,
    scope: 'global',
  }),
  defineSetting('verifier.local.model', S(), {
    group: 'judge',
    title: '내 컴퓨터 판정기 모델',
    description: '내 컴퓨터 판정기에 넘길 모델 이름이에요.',
    advanced: true,
    restartRequired: true,
    scope: 'global',
  }),
  defineSetting('verifier.local.timeoutMs', z.number().int().min(1000).max(600_000).default(20_000), {
    group: 'judge',
    title: '내 컴퓨터 판정기 기다림(밀리초)',
    description: '판정기가 이 시간 안에 답하지 않으면 멈춰요.',
    advanced: true,
    restartRequired: true,
    scope: 'global',
  }),

  // ── 도구·설치
  defineSetting('tools.budget', z.enum(['free-only', 'free-first', 'any']).default('free-first'), {
    group: 'tools',
    title: '도구 비용 기준',
    description: '도구를 추천할 때 무료 도구를 얼마나 앞세울지 정해요.',
    advanced: false,
    restartRequired: true,
    scope: 'global',
    options: { 'free-only': '무료만', 'free-first': '무료 먼저', any: '상관없음' },
  }),
  defineSetting('tools.searxng', S(), {
    group: 'tools',
    title: '내 검색 서버 주소',
    description: '직접 띄운 검색 서버 주소예요. 비우면 쓰지 않아요.',
    advanced: true,
    restartRequired: true,
    scope: 'global',
  }),
  defineSetting('tools.brave', z.boolean().default(false), {
    group: 'tools',
    title: '브레이브 검색 쓰기',
    description: '도구를 찾을 때 브레이브 검색도 함께 써요. 키가 있어야 해요.',
    advanced: false,
    restartRequired: true,
    scope: 'global',
  }),
  defineSetting('tools.braveKey', z.string().min(1), {
    group: 'tools',
    title: '브레이브 검색 키',
    description: '키는 컴퓨터의 안전한 보관함에만 저장돼요. 화면에는 가려서 보여요.',
    advanced: false,
    restartRequired: false,
    scope: 'global',
    storage: 'keychain',
    secretAccount: 'brave-search',
    widget: 'secret',
  }),
  defineSetting('assist.engine', engineId, {
    group: 'tools',
    title: '필요한 도구를 고를 AI',
    description: '어떤 도구가 필요한지 따져 볼 AI예요. 비우면 판정 AI를 써요.',
    advanced: true,
    restartRequired: false,
    scope: 'global',
    widget: 'engine',
  }),
  defineSetting('assist.model', S(), {
    group: 'tools',
    title: '도구 고르기 모델',
    description: '도구를 고를 AI가 쓸 모델이에요. 비우면 기본 모델을 써요.',
    advanced: true,
    restartRequired: false,
    scope: 'global',
    widget: 'model',
    engineKey: 'assist.engine',
  }),

  // ── 음성
  defineSetting('voice.provider', z.enum(['local', 'browser', 'off']).default('local'), {
    group: 'voice',
    title: '말로 입력하는 방법',
    description: '내 컴퓨터에서 바꿀지, 브라우저 기능을 쓸지 골라요.',
    advanced: false,
    restartRequired: false,
    scope: 'global',
    storage: 'browser',
    browserKey: 'hx.stt.provider',
    options: { local: '내 컴퓨터에서', browser: '브라우저 기능', off: '끄기' },
  }),

  // (mode·checklist·approval·attachments·project·data·about 그룹은 각 구역 작업자가 채운다)
];

/** 하네스 기본 레지스트리 */
export const settingsRegistry = new SettingsRegistry(CORE_SETTINGS);
