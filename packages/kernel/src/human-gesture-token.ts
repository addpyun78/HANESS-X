import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

/**
 * 사람 클릭 토큰 (T-100 P2-A.6) — "AI는 제안만, 실행은 사람" 원칙의 공용 모듈.
 * - 웹 화면이 사용자의 실제 클릭 때 `POST /api/gesture-tokens {kind}`로 받는다.
 * - 1회용, 기본 60초, 작업 종류(kind)에 묶인다. 세션 토큰(API 인증)과 별개다.
 * - 저장(Part 4 F.2: save-agent)과 설치·제거·업데이트가 같은 모듈을 쓴다.
 * 검증 실패(없음·재사용·만료·다른 작업 종류)는 HTTP 403으로 응답한다.
 */

export const GESTURE_KINDS = ['save-agent', 'install', 'uninstall', 'update', 'import', 'rollback'] as const;
export type GestureKind = (typeof GESTURE_KINDS)[number];

export const GESTURE_TOKEN_TTL_MS = 60_000;
/** 요청 헤더 이름 (본문의 gestureToken 필드도 허용) */
export const GESTURE_TOKEN_HEADER = 'x-harness-gesture';

export type GestureFailure = 'missing' | 'unknown' | 'reused' | 'expired' | 'wrong_kind';

export interface GestureToken {
  /** 기록용 id (installs.jsonl 등에 남긴다 — 토큰 값 자체는 남기지 않는다) */
  id: string;
  token: string;
  kind: GestureKind;
  expiresAt: string;
}

export type GestureCheck =
  { ok: true; id: string; kind: GestureKind } | { ok: false; reason: GestureFailure; message: string };

const MESSAGES: Record<GestureFailure, string> = {
  missing: '사람의 클릭 확인이 없어요. 화면에서 버튼을 눌러 주세요.',
  unknown: '알 수 없는 클릭 확인이에요. 화면에서 다시 눌러 주세요.',
  reused: '이미 쓴 클릭 확인이에요. 화면에서 다시 눌러 주세요.',
  expired: '클릭 확인 시간이 지났어요. 화면에서 다시 눌러 주세요.',
  wrong_kind: '다른 작업에 쓰는 클릭 확인이에요. 화면에서 다시 눌러 주세요.',
};

export class GestureTokenError extends Error {
  readonly status = 403;
  constructor(readonly reason: GestureFailure) {
    super(MESSAGES[reason]);
    this.name = 'GestureTokenError';
  }
}

interface Entry {
  id: string;
  kind: GestureKind;
  expiresAt: number;
  used: boolean;
}

export interface HumanGestureTokensOptions {
  ttlMs?: number;
  now?: () => number;
}

export function isGestureKind(v: unknown): v is GestureKind {
  return typeof v === 'string' && (GESTURE_KINDS as readonly string[]).includes(v);
}

export class HumanGestureTokens {
  private readonly entries = new Map<string, Entry>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(opts: HumanGestureTokensOptions = {}) {
    this.ttlMs = opts.ttlMs ?? GESTURE_TOKEN_TTL_MS;
    this.now = opts.now ?? Date.now;
  }

  issue(kind: GestureKind): GestureToken {
    if (!isGestureKind(kind)) throw new Error(`알 수 없는 작업 종류: ${String(kind)}`);
    this.prune();
    const token = randomBytes(24).toString('base64url');
    const entry: Entry = { id: randomUUID(), kind, expiresAt: this.now() + this.ttlMs, used: false };
    this.entries.set(token, entry);
    return { id: entry.id, token, kind, expiresAt: new Date(entry.expiresAt).toISOString() };
  }

  /** 확인 + 소모(1회용). 실패해도 예외 대신 결과를 돌려준다 */
  consume(token: unknown, kind: GestureKind): GestureCheck {
    if (typeof token !== 'string' || !token) return fail('missing');
    const entry = this.find(token);
    if (!entry) return fail('unknown');
    if (entry.used) return fail('reused');
    if (this.now() > entry.expiresAt) return fail('expired');
    if (entry.kind !== kind) return fail('wrong_kind');
    entry.used = true;
    return { ok: true, id: entry.id, kind };
  }

  /** consume과 같지만 실패 시 GestureTokenError(403) */
  require(token: unknown, kind: GestureKind): { id: string; kind: GestureKind } {
    const r = this.consume(token, kind);
    if (!r.ok) throw new GestureTokenError(r.reason);
    return { id: r.id, kind: r.kind };
  }

  private find(token: string): Entry | undefined {
    const given = Buffer.from(token);
    for (const [k, e] of this.entries) {
      const b = Buffer.from(k);
      if (b.length === given.length && timingSafeEqual(b, given)) return e;
    }
    return undefined;
  }

  /** 오래된 항목 정리 (재사용 판별을 위해 만료 후에도 TTL만큼 더 기억) */
  private prune(): void {
    const cutoff = this.now() - this.ttlMs;
    for (const [k, e] of this.entries) if (e.expiresAt < cutoff) this.entries.delete(k);
  }
}

function fail(reason: GestureFailure): GestureCheck {
  return { ok: false, reason, message: MESSAGES[reason] };
}

/** 요청에서 토큰 꺼내기: 헤더 x-harness-gesture 또는 본문 gestureToken */
export function gestureTokenFrom(headers: Record<string, unknown>, body: unknown): string | undefined {
  const h = headers[GESTURE_TOKEN_HEADER];
  if (typeof h === 'string' && h) return h;
  const b = body && typeof body === 'object' ? (body as { gestureToken?: unknown }).gestureToken : undefined;
  return typeof b === 'string' && b ? b : undefined;
}
