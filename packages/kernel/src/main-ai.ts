import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { MAIN_ENGINE_REF, MainAiSchema, type MainAi } from '@harness-x/protocol';
import type { LogRecord } from './event-log.js';
import { harnessHome } from './loader.js';

/**
 * T-101 5C 메인 AI — 입력창 오른쪽 아래 [엔진 · 모델 ▾]에서 고른 것.
 * 설정 `main.engine`, `main.model` (~/.harness-x/settings.json). 시스템 기능(판정·검색·에이전트 설계 등에서 설정이
 * "자동"인 경우)과 새 세션 기본값으로 쓴다.
 * 설정 레지스트리(0-1) 등록은 0A.3/6B.2에서 — 여기서는 기존 settings.json 읽기/쓰기 방식을 쓴다.
 */

export const MAIN_AI_SETTINGS_FILE = 'settings.json';

export function defaultMainAiFile(home = harnessHome()): string {
  return join(home, MAIN_AI_SETTINGS_FILE);
}

function readJson(file: string): Record<string, unknown> {
  if (!existsSync(file)) return {};
  try {
    const v = JSON.parse(readFileSync(file, 'utf8')) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** 메인 AI 읽기 (`main: {engine, model}` 또는 평평한 `main.engine`/`main.model`). 없거나 잘못되면 undefined */
export function readMainAi(file = defaultMainAiFile()): MainAi | undefined {
  const cfg = readJson(file);
  const nested = (cfg.main ?? {}) as Record<string, unknown>;
  const engine = cfg['main.engine'] ?? nested.engine;
  const model = cfg['main.model'] ?? nested.model;
  const r = MainAiSchema.safeParse({
    engine,
    ...(typeof model === 'string' && model ? { model } : {}),
  });
  return r.success ? r.data : undefined;
}

/** 메인 AI 저장 (다른 설정은 그대로 두고 main 절만 바꾼다, 원자적 기록) */
export function writeMainAi(main: MainAi, file = defaultMainAiFile()): MainAi {
  const parsed = MainAiSchema.parse(main);
  const cfg = readJson(file);
  delete cfg['main.engine'];
  delete cfg['main.model'];
  cfg.main = { engine: parsed.engine, ...(parsed.model ? { model: parsed.model } : {}) };
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(cfg, null, 2) + '\n');
  renameSync(tmp, file);
  return parsed;
}

/** 설정값이 "자동"인가 (빈 값 · auto · main) */
export const isAutoEngine = (v: string | undefined | null): boolean =>
  !v || !v.trim() || v.trim() === 'auto' || v.trim() === MAIN_ENGINE_REF;

/** "자동"이면 메인 AI 엔진, 아니면 설정값 그대로 */
export function resolveAutoEngine(
  setting: string | undefined | null,
  main: MainAi | undefined,
): string | undefined {
  if (!isAutoEngine(setting)) return setting!.trim();
  return main?.engine;
}

export interface AiChoice {
  engine: string;
  model?: string;
}

export interface NewSessionAi extends AiChoice {
  /** 어디서 정했나: 이 세션만 · 프로젝트 기본(0B.40) · 메인 AI · 없음 */
  from: 'session' | 'project' | 'main' | 'none';
}

/**
 * 5C.3/5C.3b 새 세션의 AI: 이 세션만 고른 것 → 프로젝트 기본 AI → 메인 AI.
 * 프로젝트 기본값은 0-2 작업(프로젝트)에서 만들므로 함수로 주입받는다.
 */
export function resolveSessionAi(o: {
  main?: AiChoice;
  project?: AiChoice;
  session?: AiChoice;
}): NewSessionAi | { from: 'none'; engine?: undefined } {
  if (o.session?.engine) return { ...o.session, from: 'session' };
  if (o.project?.engine) return { ...o.project, from: 'project' };
  if (o.main?.engine) return { ...o.main, from: 'main' };
  return { from: 'none' };
}

/** 5C.4 실행 중 세션에서 AI를 바꾼 기록 (이벤트 로그) */
export const SESSION_AI_EVENT = 'session_ai_changed';

export interface SessionAiChangedRecord {
  type: typeof SESSION_AI_EVENT;
  sessionId: string;
  engine: string;
  model?: string;
  /** 다음 턴부터 적용 */
  appliesFrom: 'next-turn';
}

/**
 * 5C.4 세션별 AI 바꾸기: 실행 중 세션에서 바꾸면 지금 턴은 그대로, 다음 턴부터 반영하고 기록을 남긴다.
 * 이벤트 로그를 다시 읽으면(리플레이) 같은 상태가 된다.
 */
export class SessionAiOverrides {
  private readonly map = new Map<string, AiChoice>();

  constructor(private readonly log?: { append(ev: LogRecord): unknown }) {}

  /** 바꾸기 (기록 남김). 지금 실행 중인 턴에는 영향 없음 — 다음 턴 시작 때 forTurn()이 읽는다 */
  set(sessionId: string, choice: AiChoice): SessionAiChangedRecord {
    const rec: SessionAiChangedRecord = {
      type: SESSION_AI_EVENT,
      sessionId,
      engine: choice.engine,
      ...(choice.model ? { model: choice.model } : {}),
      appliesFrom: 'next-turn',
    };
    this.map.set(sessionId, { engine: choice.engine, ...(choice.model ? { model: choice.model } : {}) });
    this.log?.append({
      id: crypto.randomUUID(),
      ts: new Date().toISOString(),
      ...rec,
    } as unknown as LogRecord);
    return rec;
  }

  /** 다음 턴을 시작할 때 쓸 AI (바꾼 적 없으면 undefined) */
  forTurn(sessionId: string): AiChoice | undefined {
    return this.map.get(sessionId);
  }

  /** 이벤트 로그 리플레이 → 같은 상태 */
  static fromEvents(events: Iterable<unknown>): SessionAiOverrides {
    const o = new SessionAiOverrides();
    for (const e of events) {
      const r = e as Partial<SessionAiChangedRecord>;
      if (r?.type === SESSION_AI_EVENT && typeof r.sessionId === 'string' && typeof r.engine === 'string')
        o.map.set(r.sessionId, { engine: r.engine, ...(r.model ? { model: r.model } : {}) });
    }
    return o;
  }
}

/**
 * 5C.3/5C.5 실행 기본 엔진: `@엔진` 수식어(이번 실행만) → 에이전트 지정 엔진 → 메인 AI → 첫 엔진.
 * 수식어는 메인 AI 설정을 바꾸지 않는다 (읽기만).
 */
export function pickRunEngine(o: {
  modifier?: string | undefined;
  agentDefault?: string | undefined;
  main?: string | undefined;
  available: readonly string[];
}): string | undefined {
  if (o.modifier) return o.modifier;
  if (!isAutoEngine(o.agentDefault)) return o.agentDefault!.trim();
  if (o.main && (o.available.length === 0 || o.available.includes(o.main))) return o.main;
  return o.available[0];
}
