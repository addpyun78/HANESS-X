import { arch, platform, release } from 'node:os';
import type { SettingsStore } from './store.js';

/**
 * T-101 6B.13 진단 파일 — 문제를 알릴 때 붙일 수 있는 기록. 키·첨부 내용은 넣지 않는다.
 *  - 넣는 것: 버전·운영체제·Node·플러그인 목록·엔진 이름·설정 값(settings 저장분 + 엔진 묶음의 방식/모델/폴백)
 *  - 빼는 것: 키체인 값(있음/없음만), 브라우저 값, 첨부 파일, 대화 내용
 *  - 마지막으로 글 전체를 훑어 키처럼 보이는 글자를 가린다(redactSecrets) — 설정 글 칸에 키를 붙여 넣은 경우까지
 */

export interface DiagnosticsInput {
  version: string;
  store: SettingsStore;
  plugins?: () => readonly { id: string; version?: string; enabled?: boolean }[];
  engines?: () => readonly string[];
  now?: () => Date;
}

/** 키처럼 보이는 글자 (API 키·토큰·비밀번호 모양) */
export const SECRET_PATTERNS: readonly RegExp[] = [
  /sk-[A-Za-z0-9_-]{8,}/g, // OpenAI·Anthropic
  /\bAIza[0-9A-Za-z_-]{20,}/g, // Google
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g, // GitHub
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g, // Slack
  /\bBSA[A-Za-z0-9_-]{16,}/g, // Brave Search
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, // JWT
  /(?:api[_-]?key|token|secret|password|passwd)\s*[=:]\s*["']?[^\s"'&,}]{6,}/gi,
  /\b[A-Za-z0-9_-]{40,}\b/g, // 아주 긴 무작위 글자
];

export const REDACTED = '(가림)';

export function redactSecrets(text: string): string {
  let out = text;
  for (const re of SECRET_PATTERNS) out = out.replace(re, REDACTED);
  return out;
}

/** 키 패턴이 몇 개 남았나 (검사용) */
export function countSecretPatterns(text: string): number {
  return SECRET_PATTERNS.reduce((n, re) => n + (text.match(new RegExp(re.source, re.flags)) ?? []).length, 0);
}

export function buildDiagnostics(o: DiagnosticsInput): string {
  const reg = o.store.registry;
  const snap = o.store.snapshot();
  const settings: Record<string, unknown> = {};
  const keys: Record<string, '있음' | '없음'> = {};
  for (const d of reg.list()) {
    const st = snap[d.key];
    const storage = d.storage ?? 'settings';
    if (storage === 'keychain') keys[d.key] = st?.masked ? '있음' : '없음';
    else if (storage === 'settings' || storage === 'engines-file')
      settings[d.key] = { value: st?.effective, from: st?.source, ...(st?.invalid ? { invalid: true } : {}) };
  }
  const report = {
    kind: 'harness-x-diagnostics',
    createdAt: (o.now ?? (() => new Date()))().toISOString(),
    version: o.version,
    system: { platform: platform(), release: release(), arch: arch(), node: process.version },
    plugins: o.plugins?.() ?? [],
    engines: o.engines?.() ?? [],
    settings,
    keys,
    note: '키 값과 첨부 파일 내용은 넣지 않았어요.',
  };
  return redactSecrets(JSON.stringify(report, null, 2)) + '\n';
}
