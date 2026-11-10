import type { HookBus } from '@harness-x/kernel';
import { currentItemOf, type ChecklistLedger } from './ledger.js';
import type { Manifest } from './manifest.js';
import type { Checklist, ChecklistItem } from './schema.js';

/**
 * 컨텍스트 슬라이스 (T-029 29.1·29.2)
 * 엔진 컨텍스트에는 체크리스트 전체가 아니라 "지금 필요한 조각"만 넣는다:
 * 현재 항목·부모·다음 3개·최근 실패 사유·정식 경로. UTF-8 2KB 이내를 보장한다.
 * 매 턴 시작 시 프롬프트 앞에, 그리고 context.compact(압축) 뒤에 다시 주입한다.
 */

export const SLICE_MAX_BYTES = 2048;
export const SLICE_OPEN = '<harness-checklist>';
export const SLICE_CLOSE = '</harness-checklist>';

export interface SliceSource {
  checklist: Checklist | null;
  manifest?: Manifest | null;
}

export interface ContextSlice {
  text: string;
  bytes: number;
  /** 현재 항목 id (없으면 null — 모두 완료 등) */
  itemId: string | null;
}

/** 최근 실패 사유: failed 판정 사유 또는 마지막 실패류 증거 요약 */
export function lastFailureReason(item: ChecklistItem): string | null {
  for (let k = item.evidence.length - 1; k >= 0; k--) {
    const e = item.evidence[k]!;
    if (/fail|error|reject|stall/i.test(e.kind) || (e as { ok?: unknown }).ok === false)
      return e.summary ?? e.kind;
  }
  if (item.verdict && item.verdict.verdict !== 'equal' && item.verdict.verdict !== 'relocated')
    return item.verdict.reason;
  return item.status === 'failed' ? '검증 실패 (사유 미기록)' : null;
}

function bytes(s: string): number {
  return Buffer.byteLength(s, 'utf8');
}

/** UTF-8 바이트 기준으로 자르기 (문자 중간에서 자르지 않음) */
export function clipBytes(s: string, max: number): string {
  if (bytes(s) <= max) return s;
  let out = '';
  for (const ch of s) {
    if (bytes(out + ch + '…') > max) break;
    out += ch;
  }
  return out + '…';
}

function acceptanceLine(item: ChecklistItem): string {
  return item.acceptance
    .map((a) => {
      if (a.type === 'command' || a.type === 'test') return `${a.type}: ${a.run}`;
      if (a.type === 'file_exists') return `file_exists${a.file ? `: ${a.file}` : ''}`;
      if (a.type === 'symbol') return `symbol: ${a.symbol}`;
      if (a.type === 'schema') return `schema${a.file ? `: ${a.file}` : ''}`;
      return 'llm';
    })
    .join('; ');
}

/** 슬라이스 본문을 만든다. fieldMax: 자유 텍스트 필드 바이트 한도 (2KB 맞추기용으로 점점 줄인다) */
function render(src: SliceSource, fieldMax: number, nextCount: number): ContextSlice {
  const c = src.checklist;
  const clip = (s: string) => clipBytes(s.replace(/\s+/g, ' ').trim(), fieldMax);
  const lines: string[] = [SLICE_OPEN];
  const cur = c ? currentItemOf(c) : null;
  if (!c) lines.push('체크리스트 없음');
  else if (!cur) {
    const rest = c.items.filter((i) => i.status !== 'done');
    lines.push(rest.length ? `진행 가능한 항목 없음 (남은 ${rest.length}개는 blocked)` : '모든 항목 완료');
  } else {
    const done = c.items.filter((i) => i.status === 'done').length;
    lines.push(`진행: ${done}/${c.items.length} 완료`);
    lines.push(`현재 항목 ${cur.id} [${cur.status}, 시도 ${cur.attempts}]: ${clip(cur.title)}`);
    const parent = cur.parent ? c.items.find((i) => i.id === cur.parent) : undefined;
    if (parent) lines.push(`부모 ${parent.id}: ${clip(parent.title)}`);
    const entry = src.manifest?.artifacts[cur.artifactId];
    lines.push(`정식 경로 (${cur.artifactId}): ${entry ? clip(entry.path) : '(manifest 미확정)'}`);
    lines.push(`완료 조건: ${clip(acceptanceLine(cur))}`);
    const fail = lastFailureReason(cur);
    if (fail) lines.push(`최근 실패 사유: ${clip(fail)}`);
    const next = c.items.filter((i) => i.status === 'todo' && i.id !== cur.id).slice(0, nextCount);
    if (next.length) {
      lines.push('다음 항목:');
      for (const n of next) lines.push(`- ${n.id}: ${clip(n.title)}`);
    }
    lines.push('정식 경로에만 쓰고, 끝나면 checklist.submit으로 증거를 제출하세요.');
  }
  lines.push(SLICE_CLOSE);
  const text = lines.join('\n');
  return { text, bytes: bytes(text), itemId: cur?.id ?? null };
}

/** 29.1 슬라이스 생성 (≤ maxBytes, 기본 2KB) */
export function buildSlice(src: SliceSource, maxBytes = SLICE_MAX_BYTES): ContextSlice {
  for (const [fieldMax, nextCount] of [
    [400, 3],
    [240, 3],
    [160, 3],
    [96, 3],
    [64, 2],
    [40, 1],
  ] as const) {
    const s = render(src, fieldMax, nextCount);
    if (s.bytes <= maxBytes) return s;
  }
  const s = render(src, 24, 0);
  if (s.bytes <= maxBytes) return s;
  const text = clipBytes(s.text, maxBytes - bytes(`\n${SLICE_CLOSE}`) - 4) + `\n${SLICE_CLOSE}`;
  return { text, bytes: bytes(text), itemId: s.itemId };
}

/** 원장(+manifest)에서 바로 슬라이스 */
export function sliceOf(ledger: ChecklistLedger, manifest?: { read(): Manifest | null }): ContextSlice {
  let m: Manifest | null = null;
  try {
    m = manifest?.read() ?? null;
  } catch {
    m = null; // 변조된 manifest는 슬라이스에서 빼고 진행(판정은 다른 곳에서 막는다)
  }
  return buildSlice({ checklist: ledger.read(), manifest: m });
}

/** 프롬프트 앞에 슬라이스를 붙인다 (이미 붙은 슬라이스는 교체) */
export function withSlice(prompt: string, slice: ContextSlice): string {
  const start = prompt.indexOf(SLICE_OPEN);
  const end = prompt.indexOf(SLICE_CLOSE);
  const body = start === 0 && end > 0 ? prompt.slice(end + SLICE_CLOSE.length).replace(/^\n+/, '') : prompt;
  return `${slice.text}\n\n${body}`;
}

/**
 * 29.2 슬라이스 재주입기
 *  - preparePrompt: 매 턴 시작 시 프롬프트 앞에 최신 슬라이스 (runWithStopGuard의 preparePrompt로 넘긴다)
 *  - install(hooks): context.compact 차단형 훅 → patch.inject에 슬라이스. 압축을 수행한 쪽은 압축 요약 뒤
 *    patch.inject를 다음 프롬프트에 넣는다(compactedPrompt 도우미)
 */
export class SliceInjector {
  constructor(
    readonly ledger: ChecklistLedger,
    readonly manifest?: { read(): Manifest | null },
  ) {}

  slice(): ContextSlice {
    return sliceOf(this.ledger, this.manifest);
  }

  preparePrompt = (prompt: string): string => withSlice(prompt, this.slice());

  install(hooks: HookBus, opts: { pluginId?: string } = {}): () => void {
    return hooks.onBlocking(
      'context.compact',
      () => {
        const s = this.slice();
        return {
          decision: 'allow',
          patch: { inject: s.text, ...(s.itemId ? { itemId: s.itemId } : {}) },
        };
      },
      { id: 'checklist-ledger:slice', ...(opts.pluginId ? { pluginId: opts.pluginId } : {}) },
    );
  }
}

/** 압축 뒤 프롬프트: 요약 + context.compact 훅이 준 inject (없으면 요약만) */
export async function compactedPrompt(hooks: HookBus, ctx: { sessionId: string; summary: string }) {
  const out = await hooks.runBlocking('context.compact', { sessionId: ctx.sessionId, summary: ctx.summary });
  const inject = typeof out.patch?.inject === 'string' ? out.patch.inject : '';
  return inject ? `${inject}\n\n${ctx.summary}` : ctx.summary;
}
