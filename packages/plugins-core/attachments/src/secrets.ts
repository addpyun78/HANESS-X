import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { representation, type Attachment, type AttachmentWarning } from '@harness-x/protocol';
import { SECRET_PATTERNS } from '@harness-x/kernel';
import { warn, writeRep } from './context.js';
import { extOf } from './detect.js';
import { MESSAGES, SECRET_CHOICE_LABELS } from './messages.js';
import type { AttachmentEventSink, AttachmentStore } from './store.js';
import { toUtf8Text } from './text.js';

/**
 * 1C.2 비밀 검사: .env 파일이거나 키 패턴이 들어 있으면 카드
 *   "비밀번호나 키가 들어 있어요" [가리고 보내기(추천)] [그대로 보내기] [빼기]
 * 1C.3 첨부 내용은 로그·이벤트에 원문으로 남기지 않는다(경로·해시만).
 */

const MASK = '••••••';

/** 커널 비밀 패턴(sk-·AIza·ghp_·AKIA·Bearer 등) + 개인 키 + 이름에 KEY/SECRET/TOKEN/PASSWORD가 든 값 */
const EXTRA_PATTERNS: { name: string; re: RegExp }[] = [
  { name: 'private-key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  {
    name: 'assignment',
    re: /^(\s*(?:export\s+)?[A-Za-z0-9_.-]*(?:key|secret|token|password|passwd|pwd|credential)[A-Za-z0-9_.-]*\s*[:=]\s*)(["']?)([^\s"'#]{4,})\2/gim,
  },
];

export interface SecretFinding {
  kind: string;
  line: number;
}

export function isEnvFile(name: string): boolean {
  return extOf(name) === '.env';
}

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split('\n').length;
}

/** 비밀 위치 (값은 돌려주지 않는다) */
export function scanSecrets(text: string, name = ''): SecretFinding[] {
  const out: SecretFinding[] = [];
  for (const { name: kind, re } of [...SECRET_PATTERNS, ...EXTRA_PATTERNS])
    for (const m of text.matchAll(new RegExp(re.source, re.flags)))
      out.push({ kind, line: lineOf(text, m.index) });
  if (isEnvFile(name))
    for (const m of text.matchAll(/^\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=\s*\S+/gm))
      out.push({ kind: 'env', line: lineOf(text, m.index) });
  const seen = new Set<string>();
  return out.filter((f) => {
    const k = `${f.kind}:${f.line}`;
    return seen.has(k) ? false : (seen.add(k), true);
  });
}

/** 비밀 값만 가린 글 (이름은 남긴다) */
export function maskSecretText(text: string, name = ''): string {
  let out = text;
  if (isEnvFile(name))
    out = out.replace(
      /^(\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=\s*)(.+)$/gm,
      (_m, k: string) => `${k}${MASK}`,
    );
  out = out.replace(EXTRA_PATTERNS[0]!.re, MASK);
  out = out.replace(EXTRA_PATTERNS[1]!.re, (_m, k: string, q: string) => `${k}${q}${MASK}${q}`);
  for (const { re } of SECRET_PATTERNS) out = out.replace(new RegExp(re.source, re.flags), MASK);
  return out;
}

export type SecretChoice = keyof typeof SECRET_CHOICE_LABELS;

/** 화면에 띄울 카드 (값은 넣지 않는다) */
export interface SecretCard {
  attachmentId: string;
  title: string;
  findings: SecretFinding[];
  choices: { id: SecretChoice; label: string; recommended: boolean }[];
}

export function secretCard(a: Pick<Attachment, 'id'>, findings: SecretFinding[]): SecretCard {
  return {
    attachmentId: a.id,
    title: MESSAGES.secretFound,
    findings,
    choices: (Object.keys(SECRET_CHOICE_LABELS) as SecretChoice[]).map((id) => ({
      id,
      label: SECRET_CHOICE_LABELS[id],
      recommended: id === 'mask',
    })),
  };
}

/** 첨부의 글(글 형태가 있으면 그것, 글 파일이면 원본)을 읽어 비밀 검사 */
export function findSecrets(a: Attachment): SecretFinding[] {
  const rep = representation(a, 'text') ?? representation(a, 'transcript');
  const file = rep?.path ?? (a.kind === 'text' || a.kind === 'executable' ? a.storedPath : undefined);
  if (!file || !existsSync(file)) return isEnvFile(a.originalName) ? [{ kind: 'env', line: 1 }] : [];
  return scanSecrets(toUtf8Text(readFileSync(file)).text, a.originalName);
}

/** 변환 뒤 검사: 비밀이 있으면 안내를 붙인다 (카드는 secretCard로) */
export function withSecretWarning(a: Attachment): { attachment: Attachment; card?: SecretCard } {
  const findings = findSecrets(a);
  if (findings.length === 0) return { attachment: a };
  const w: AttachmentWarning = warn('secret-found', MESSAGES.secretFound);
  return {
    attachment: { ...a, warnings: [...a.warnings.filter((x) => x.code !== 'secret-found'), w] },
    card: secretCard(a, findings),
  };
}

/**
 * 카드에서 고른 것 적용.
 *  - mask: 비밀을 가린 글(masked-text)을 만들어 그것만 보낸다 (전달 선택기가 원본 대신 씀)
 *  - send: 그대로 (안내만 남김)
 *  - remove: 첨부를 지운다 (undefined)
 */
export function applySecretChoice(
  store: AttachmentStore,
  a: Attachment,
  choice: SecretChoice,
): Attachment | undefined {
  const sid = a.sessionId!;
  const keep = a.warnings.filter((w) => w.code !== 'secret-found');
  if (choice === 'remove') {
    rmSync(store.attachmentDir(sid, a.id), { recursive: true, force: true });
    return undefined;
  }
  let next: Attachment;
  if (choice === 'send') next = { ...a, warnings: [...keep, warn('secret-sent', MESSAGES.secretSentAsIs)] };
  else {
    const rep = representation(a, 'text') ?? representation(a, 'transcript');
    const src = rep?.path ?? a.storedPath;
    const masked = maskSecretText(toUtf8Text(readFileSync(src)).text, a.originalName);
    const r = writeRep(
      { dir: store.attachmentDir(sid, a.id) },
      'masked-text',
      'masked.txt',
      masked,
      'text/plain; charset=utf-8',
    );
    next = {
      ...a,
      representations: [...a.representations.filter((x) => x.form !== 'masked-text'), r],
      warnings: [...keep, warn('secret-masked', MESSAGES.secretMasked)],
    };
  }
  store.save(next);
  return next;
}

/** 커널 EventLog(id·ts·sessionId 필요)에 붙이는 이벤트 받기 — 첨부 기록은 경로·해시만 */
export function eventLogSink(
  log: {
    append(r: { id: string; ts: string; sessionId: string; type: string } & Record<string, unknown>): unknown;
  },
  fallbackSessionId = 'attachments',
): AttachmentEventSink {
  return {
    append: (r) =>
      log.append({
        id: randomUUID(),
        ts: new Date().toISOString(),
        sessionId: typeof r.sessionId === 'string' ? r.sessionId : fallbackSessionId,
        ...r,
      }),
  };
}
