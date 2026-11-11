import { maskSecrets } from '@harness-x/kernel';
import type { JudgeInput } from './questions.js';
import type { JudgeRequest } from './types.js';

/**
 * E.9 전송 상한·마스킹 (데이터 최소화)
 *   - 값마다 UTF-8 2KB 상한 (넘으면 잘라내고 표시)
 *   - 비밀 패턴 마스킹: 커널 secrets-mask(T-004) 그대로 재사용
 *   - 소스 코드 본문 금지: 코드로 보이는 여러 줄 값은 "[source code omitted …]"로 바꾼다
 *   - 보내는 필드는 kind · itemTitle · expected · actual 4개뿐
 */

export const JUDGE_MAX_VALUE_BYTES = 2048;
export const TRUNCATION_MARK = ' …[truncated]';

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: false });

export function utf8Bytes(s: string): number {
  return enc.encode(s).length;
}

/** UTF-8 기준 maxBytes 이하로 자른다 (글자 중간에서 끊지 않음, 표시 문구 포함 상한) */
export function capBytes(s: string, maxBytes = JUDGE_MAX_VALUE_BYTES): string {
  const bytes = enc.encode(s);
  if (bytes.length <= maxBytes) return s;
  const room = Math.max(0, maxBytes - utf8Bytes(TRUNCATION_MARK));
  const cut = dec.decode(bytes.subarray(0, room)).replace(/�+$/, '');
  return cut + TRUNCATION_MARK;
}

const CODE_LINE =
  /^\s*(?:import\s|export\s|from\s+\S+\s+import\s|def\s|class\s|function\b|async\s+function\b|const\s|let\s|var\s|public\s|private\s|protected\s|package\s|#include\b|using\s|fn\s|func\s|return\b|if\s*\(|for\s*\(|while\s*\(|\}\s*(?:else\b.*)?$|.*[{;]\s*$|\/\/|\/\*)/;

/** 3줄 이상이고 절반 이상이 코드 줄처럼 보이면 소스 코드로 본다 (JSON 값은 예외) */
export function looksLikeSourceCode(s: string): boolean {
  const lines = s.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 3) return false;
  try {
    JSON.parse(s);
    return false;
  } catch {
    /* JSON 아님 */
  }
  const codeLines = lines.filter((l) => CODE_LINE.test(l)).length;
  return codeLines / lines.length >= 0.5;
}

export function sanitizeValue(value: string, opts: { allowCode?: boolean } = {}): string {
  let v = maskSecrets(value);
  if (!opts.allowCode && looksLikeSourceCode(v)) {
    v = `[source code omitted: ${v.split(/\r?\n/).length} lines]`;
  }
  return capBytes(v);
}

/** 판정 요청 → 판정기로 보낼 입력 4개 필드만 (sessionId·authorEngineId 등은 보내지 않는다) */
export function sanitizeJudgeInput(req: JudgeRequest): JudgeInput {
  const allowCode = req.kind === 'json';
  return {
    kind: capBytes(maskSecrets(req.kind), 64),
    itemTitle: capBytes(maskSecrets(req.itemTitle)),
    expected: sanitizeValue(req.expected, { allowCode }),
    actual: sanitizeValue(req.actual, { allowCode }),
  };
}
