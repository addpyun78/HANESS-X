import { randomUUID } from 'node:crypto';
import { z } from 'zod';

/**
 * 판정 설정 (T-100 P1-J.4·J.5)
 * 예전 `verifier.l4`(L4 판정기 선택) 키는 폐기했다. 의미 판단 설정은 모두 `judge.*` 아래에 둔다(E.1).
 *   judge.engine   — 의미 판단 엔진 id (빈 값 = 자동 선택)
 *   judge.semantic — on | off (off면 의미 판단 없이 즉시 실패)
 * E.1의 나머지 키(model·samples·maxCallsPerSession·local.*)는 judge 패키지가 정의하며 여기서는 그대로 통과시킨다.
 */

export const JUDGE_SEMANTIC_MODES = ['on', 'off'] as const;

export const JudgeSettingsSchema = z.looseObject({
  engine: z.string().default(''),
  semantic: z.enum(JUDGE_SEMANTIC_MODES).default('on'),
});
export type JudgeSettings = z.infer<typeof JudgeSettingsSchema>;

/** 폐기된 키를 쓰면 나는 오류 — migrateVerifierConfig()로 옮겨야 한다 */
export class LegacyVerifierConfigError extends Error {
  readonly code = 'LEGACY_VERIFIER_CONFIG';
  constructor(readonly key: string) {
    super(`설정 '${key}'는 폐기되었습니다 — judge.* 설정을 쓰세요 (migrateVerifierConfig로 자동 변환)`);
    this.name = 'LegacyVerifierConfigError';
  }
}

/** 계속 쓰는 판정 방식 이름 — verifier.local(로컬 판정기 플러그인 설정)은 그대로 둔다.
 * 그 밖의 verifier.<이름> 절은 삭제된 외부 판정 서비스 설정으로 본다 */
export const KEPT_VERIFIER_NAMES: ReadonlySet<string> = new Set(['local', 'engine', 'off']);

function verifierSection(config: Record<string, unknown>): Record<string, unknown> {
  const v = config.verifier;
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** 설정 안의 폐기 키 경로 (없으면 빈 배열) */
export function legacyVerifierKeys(config: Record<string, unknown>): string[] {
  const out: string[] = [];
  if ('verifier.l4' in config) out.push('verifier.l4');
  for (const k of Object.keys(verifierSection(config)))
    if (k === 'l4' || !KEPT_VERIFIER_NAMES.has(k)) out.push(`verifier.${k}`);
  return [...new Set(out)];
}

/** J.4 설정 → judge 설정. 폐기된 `verifier.*` 키가 있으면 LegacyVerifierConfigError */
export function judgeSettingsFrom(config: Record<string, unknown> = {}): JudgeSettings {
  const legacy = legacyVerifierKeys(config);
  if (legacy.length) throw new LegacyVerifierConfigError(legacy[0]!);
  const flat = Object.fromEntries(
    Object.entries(config)
      .filter(([k]) => k.startsWith('judge.'))
      .map(([k, v]) => [k.slice('judge.'.length), v]),
  );
  const nested = (config.judge ?? {}) as Record<string, unknown>;
  return JudgeSettingsSchema.parse({ ...nested, ...flat });
}

// ── J.5 설정 마이그레이션: verifier.l4 → judge.* ─────────────────────
export interface ConfigMigratedEvent {
  type: 'config_migrated';
  /** 옮긴 키 */
  key: 'verifier.l4';
  /** 예전 값 (없으면 null — verifier.* 절만 있던 경우) */
  from: string | null;
  /** 새로 정한 값 (judge.engine 또는 judge.semantic) */
  to: Record<string, string>;
  /** 지운 키 경로 */
  removed: string[];
}

/** 이벤트 로그 (kernel EventLog와 호환) */
export interface SettingsEventSink {
  append(
    event: { id: string; ts: string; sessionId: string; type: string } & Record<string, unknown>,
  ): unknown;
}

export interface MigrateEventOptions {
  /** 있으면 config_migrated 이벤트를 남긴다 */
  log?: SettingsEventSink;
  /** 이벤트 세션 (기본 'harness-system') */
  sessionId?: string;
  now?: () => Date;
  idGen?: () => string;
}

/** 세션 밖(시작 시 1회) 작업의 이벤트 세션 id */
export const SYSTEM_SESSION_ID = 'harness-system';

export interface MigrateVerifierResult {
  config: Record<string, unknown>;
  migrated: boolean;
  event?: ConfigMigratedEvent;
  /** 설정에 남아 있던 삭제된 외부 판정 서비스 이름 (J.2 lock·J.6 키 정리에 쓴다) */
  retired: string[];
}

/**
 * `verifier.l4`가 (삭제된 외부 서비스)·local·engine(off 밖의 모든 값)이면 judge.engine = ""(자동),
 * off면 judge.semantic = off. 폐기 키(verifier.*, 'verifier.l4')는 지운다. 입력은 바꾸지 않는다.
 */
export function migrateVerifierConfig(
  config: Record<string, unknown> = {},
  opts: MigrateEventOptions = {},
): MigrateVerifierResult {
  const removed = legacyVerifierKeys(config);
  if (removed.length === 0) return { config, migrated: false, retired: [] };
  const section = verifierSection(config);
  const raw = section.l4 ?? config['verifier.l4'];
  const from = typeof raw === 'string' ? raw : null;
  const retired = [
    ...new Set(
      [...Object.keys(section), ...(from ? [from] : [])].filter(
        (k) => k !== 'l4' && !KEPT_VERIFIER_NAMES.has(k),
      ),
    ),
  ];
  const { verifier: _v, 'verifier.l4': _f, ...rest } = config;
  const kept = Object.fromEntries(
    Object.entries(section).filter(([k]) => k !== 'l4' && KEPT_VERIFIER_NAMES.has(k)),
  );
  if (Object.keys(kept).length) rest.verifier = kept;
  const judge = { ...((rest.judge as Record<string, unknown> | undefined) ?? {}) };
  const to: Record<string, string> = {};
  if (from === 'off') {
    judge.semantic = 'off';
    to['judge.semantic'] = 'off';
  } else if (from !== null) {
    judge.engine = '';
    to['judge.engine'] = '';
  }
  const next = Object.keys(judge).length ? { ...rest, judge } : rest;
  const event: ConfigMigratedEvent = { type: 'config_migrated', key: 'verifier.l4', from, to, removed };
  opts.log?.append({
    id: (opts.idGen ?? randomUUID)(),
    ts: (opts.now ?? (() => new Date()))().toISOString(),
    sessionId: opts.sessionId ?? SYSTEM_SESSION_ID,
    ...event,
  });
  return { config: next, migrated: true, event, retired };
}
