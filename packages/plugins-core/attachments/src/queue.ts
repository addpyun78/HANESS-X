import { readFileSync } from 'node:fs';
import type { Attachment } from '@harness-x/protocol';
import type { ConvertContext, ConvertOutput, Converter } from './context.js';
import { warn } from './context.js';
import { MESSAGES } from './messages.js';
import { withSecretWarning, type SecretCard } from './secrets.js';
import type { AttachmentEventSink, AttachmentStore } from './store.js';
import { systemTools } from './tools.js';

/**
 * 1B.1 형태 바꾸기 대기열 (백그라운드, 동시 2개).
 * 칩에 진행 상태(converting → ready / failed)를 알리고, 실패해도 원본 첨부는 그대로 둔다.
 */

export type ProgressListener = (a: Attachment) => void;

export interface ConversionQueueOptions {
  store: AttachmentStore;
  /** 종류별 변환기 (기본 DEFAULT_CONVERTERS) */
  converters: Partial<Record<Attachment['kind'], Converter>>;
  /** 기본 2 (설정 attachments.concurrency) */
  concurrency?: number;
  context?: Partial<Omit<ConvertContext, 'dir'>>;
  onProgress?: ProgressListener;
  /** 1C.2 비밀이 들어 있으면 카드 (값은 넣지 않음) */
  onSecret?: (card: SecretCard) => void;
  /** 1C.3 기록은 경로·해시·종류만 (원문 금지) */
  events?: AttachmentEventSink;
}

export class ConversionQueue {
  private readonly waiting: { a: Attachment; done: (a: Attachment) => void }[] = [];
  private running = 0;
  /** 지금까지 동시에 돈 최대 개수 (테스트용) */
  peak = 0;
  private readonly concurrency: number;

  constructor(private readonly o: ConversionQueueOptions) {
    this.concurrency = o.concurrency ?? o.store.limits.concurrency;
  }

  /** 넣고 끝날 때까지 기다릴 수 있는 약속을 돌려준다 */
  enqueue(a: Attachment): Promise<Attachment> {
    return new Promise((done) => {
      this.waiting.push({ a, done });
      this.o.onProgress?.({ ...a, status: 'converting' });
      this.pump();
    });
  }

  get pending(): number {
    return this.waiting.length + this.running;
  }

  private pump(): void {
    while (this.running < this.concurrency && this.waiting.length) {
      const job = this.waiting.shift()!;
      this.running++;
      this.peak = Math.max(this.peak, this.running);
      void this.convert(job.a).then((res) => {
        this.running--;
        job.done(res);
        this.pump();
      });
    }
  }

  private async convert(a: Attachment): Promise<Attachment> {
    const sid = a.sessionId!;
    const ctx: ConvertContext = {
      tools: systemTools,
      ...this.o.context,
      dir: this.o.store.attachmentDir(sid, a.id),
    };
    let next: Attachment;
    try {
      const conv = this.o.converters[a.kind];
      const out: ConvertOutput = conv
        ? await conv(a, readFileSync(a.storedPath), ctx)
        : { representations: [], warnings: [] };
      next = {
        ...a,
        representations: [...a.representations, ...out.representations],
        warnings: [...a.warnings, ...out.warnings],
        status: 'ready',
      };
    } catch {
      // 원본은 그대로 — 상태만 실패로 (오류 내용에 첨부 원문이 섞일 수 있어 남기지 않는다)
      next = {
        ...a,
        status: 'failed',
        warnings: [...a.warnings, warn('convert-failed', MESSAGES.convertFailed)],
      };
    }
    if (next.status === 'ready') {
      const checked = withSecretWarning(next);
      next = checked.attachment;
      if (checked.card) this.o.onSecret?.(checked.card);
    }
    this.o.store.save(next);
    this.o.events?.append({
      type: 'attachment_converted',
      sessionId: sid,
      attachmentId: next.id,
      sha256: next.sha256,
      status: next.status,
      path: next.storedPath,
      forms: next.representations.map((r) => r.form),
      warnings: next.warnings.map((w) => w.code),
    });
    this.o.onProgress?.(next);
    return next;
  }
}
