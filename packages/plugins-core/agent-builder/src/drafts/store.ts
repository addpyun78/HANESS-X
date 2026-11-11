import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AgentDraftSchema, type AgentDraft } from '@harness-x/protocol';
import { harnessHome } from '@harness-x/kernel';

/**
 * 초안 저장소 ~/.harness-x/drafts/<id>.json (HOME 주입 가능)
 *   P4-E.6 초안 버전: 적용될 때마다 v1, v2… 쌓고, 이전 버전 보기·되돌리기(되돌리기도 새 버전)
 *   P4-F.9 초안 자동 보관: 저장 전 창을 닫아도 남는다 (working = 마지막 화면 상태)
 *   P4-F.10 초안 목록·삭제, 30일 지난 초안은 정리 "제안"만 (자동 삭제 금지)
 * 에이전트 저장(레지스트리)과는 별개 — 여기에 쓰는 것으로는 / 목록에 아무것도 생기지 않는다.
 */

export const DRAFT_STALE_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;

export const VERSION_SOURCES = ['ai', 'ai-patch', 'canvas', 'yaml', 'revert'] as const;
export type VersionSource = (typeof VERSION_SOURCES)[number];

const DraftVersionSchema = z
  .object({
    v: z.number().int().min(1),
    at: z.string(),
    source: z.enum(VERSION_SOURCES),
    /** 바뀐 점 한 줄 (쉬운 말) */
    note: z.string().optional(),
    draft: AgentDraftSchema,
  })
  .strict();
export type DraftVersion = z.infer<typeof DraftVersionSchema>;

const ChatLineSchema = z.object({ role: z.enum(['user', 'ai']), text: z.string() }).strict();
export type ChatLine = z.infer<typeof ChatLineSchema>;

export const DraftRecordSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    /** 요청 원문 */
    request: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
    /** 설계에 쓴 엔진 */
    designEngine: z.string().optional(),
    conversation: z.array(ChatLineSchema).default([]),
    versions: z.array(DraftVersionSchema).min(1),
    /** 버전으로 남기지 않은 마지막 화면 상태 (캔버스 직접 수정 자동 보관) */
    working: AgentDraftSchema.optional(),
  })
  .strict();
export type DraftRecord = z.infer<typeof DraftRecordSchema>;

export interface DraftListItem {
  id: string;
  displayName: string;
  request: string;
  updatedAt: string;
  versions: number;
  gaps: number;
  /** 30일 지남 → 정리 제안 */
  stale: boolean;
}

export interface DraftStoreOptions {
  home?: string;
  now?: () => Date;
}

export class DraftStore {
  private readonly now: () => Date;
  constructor(private readonly o: DraftStoreOptions = {}) {
    this.now = o.now ?? (() => new Date());
  }

  get dir(): string {
    return join(this.o.home ?? harnessHome(), 'drafts');
  }

  private file(id: string) {
    if (!/^[a-z0-9-]+$/.test(id)) throw new Error(`잘못된 초안 id: ${id}`);
    return join(this.dir, `${id}.json`);
  }

  private write(r: DraftRecord): DraftRecord {
    mkdirSync(this.dir, { recursive: true });
    const f = this.file(r.id);
    const tmp = `${f}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(r, null, 2));
    renameSync(tmp, f);
    return r;
  }

  create(i: {
    request: string;
    draft: AgentDraft;
    designEngine?: string;
    conversation?: ChatLine[];
  }): DraftRecord {
    const at = this.now().toISOString();
    return this.write({
      id: randomUUID(),
      request: i.request,
      createdAt: at,
      updatedAt: at,
      ...(i.designEngine ? { designEngine: i.designEngine } : {}),
      conversation: i.conversation ?? [],
      versions: [{ v: 1, at, source: 'ai', draft: AgentDraftSchema.parse(i.draft) }],
    });
  }

  get(id: string): DraftRecord | undefined {
    const f = this.file(id);
    if (!existsSync(f)) return undefined;
    try {
      return DraftRecordSchema.parse(JSON.parse(readFileSync(f, 'utf8')));
    } catch {
      return undefined;
    }
  }

  private must(id: string): DraftRecord {
    const r = this.get(id);
    if (!r) throw new Error(`초안 없음: ${id}`);
    return r;
  }

  current(id: string): AgentDraft | undefined {
    const r = this.get(id);
    return r ? (r.working ?? r.versions.at(-1)!.draft) : undefined;
  }

  /** 새 버전 (v = 마지막 + 1). working은 비운다 */
  addVersion(id: string, draft: AgentDraft, source: VersionSource, note?: string): DraftRecord {
    const r = this.must(id);
    const at = this.now().toISOString();
    const v = r.versions.at(-1)!.v + 1;
    const { working: _w, ...rest } = r;
    return this.write({
      ...rest,
      updatedAt: at,
      versions: [
        ...r.versions,
        { v, at, source, ...(note ? { note } : {}), draft: AgentDraftSchema.parse(draft) },
      ],
    });
  }

  /** 버전을 남기지 않는 자동 보관 (캔버스 직접 수정) */
  saveWorking(id: string, draft: AgentDraft): DraftRecord {
    const r = this.must(id);
    return this.write({ ...r, updatedAt: this.now().toISOString(), working: AgentDraftSchema.parse(draft) });
  }

  appendConversation(id: string, lines: ChatLine[]): DraftRecord {
    const r = this.must(id);
    return this.write({
      ...r,
      updatedAt: this.now().toISOString(),
      conversation: [...r.conversation, ...lines],
    });
  }

  version(id: string, v: number): DraftVersion | undefined {
    return this.get(id)?.versions.find((x) => x.v === v);
  }

  /** 이전 버전으로 되돌리기 = 그 내용으로 새 버전을 만든다 (기록은 지우지 않는다) */
  revert(id: string, v: number): DraftRecord {
    const old = this.version(id, v);
    if (!old) throw new Error(`버전 없음: v${v}`);
    return this.addVersion(id, old.draft, 'revert', `v${v}로 되돌렸어요.`);
  }

  list(): DraftListItem[] {
    if (!existsSync(this.dir)) return [];
    const now = this.now().getTime();
    const out: DraftListItem[] = [];
    for (const f of readdirSync(this.dir)) {
      if (!f.endsWith('.json')) continue;
      const r = this.get(f.slice(0, -5));
      if (!r) continue;
      const d = r.working ?? r.versions.at(-1)!.draft;
      out.push({
        id: r.id,
        displayName: d.displayName,
        request: r.request,
        updatedAt: r.updatedAt,
        versions: r.versions.length,
        gaps: d.gaps.length,
        stale: now - Date.parse(r.updatedAt) > DRAFT_STALE_DAYS * DAY,
      });
    }
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  /** 사용자가 [삭제]를 눌렀을 때만 */
  remove(id: string): boolean {
    const f = this.file(id);
    if (!existsSync(f)) return false;
    rmSync(f);
    return true;
  }
}
