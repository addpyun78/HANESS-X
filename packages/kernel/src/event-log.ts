import {
  closeSync,
  createReadStream,
  existsSync,
  fstatSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  rmSync,
  writeSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import {
  EventBaseSchema,
  HARNESS_EVENT_TYPES,
  HarnessEventSchema,
  type EventBase,
} from '@harness-x/protocol';
import { maskDeep } from './secrets-mask.js';

/**
 * 이벤트 로그
 * - 세션별 <root>/sessions/<sessionId>/events.jsonl (한 줄 = 한 이벤트, append-only)
 * - <root>/index.sqlite: (sessionId, type, itemId, ts) 인덱스 + 파일 오프셋
 * - 쓰기 전 비밀 마스킹
 *
 * HarnessEvent 9종은 스키마로 엄격 검증하고, 커널 내부 기록(hook_result 등)은
 * 공통 필드만 검증한다.
 */

export type LogRecord = EventBase & { type: string } & Record<string, unknown>;

export interface EventQuery {
  sessionId?: string;
  type?: string;
  itemId?: string;
  /** ts >= since (ISO) */
  since?: string;
  /** ts <= until (ISO) */
  until?: string;
  limit?: number;
}

export interface EventLogOptions {
  /** 로그 루트 디렉터리 (예: ~/.harness-x/logs) */
  root: string;
  /** true면 append마다 fsync (기본 false) */
  fsync?: boolean;
}

const HARNESS_TYPES = new Set<string>(HARNESS_EVENT_TYPES);
const SESSION_ID_RE = /^[A-Za-z0-9._-]{1,128}$/;

type Listener = (rec: LogRecord) => void;

export class EventLog {
  readonly root: string;
  private readonly db: DatabaseSync;
  private readonly insert: StatementSync;
  private readonly fds = new Map<string, number>();
  private readonly fsyncEach: boolean;
  private readonly listeners = new Set<Listener>();
  private closed = false;
  private readonly sizes = new Map<string, number>();
  private pending: [string, string, string, string | null, string, number, number][] = [];
  private flushTimer: NodeJS.Immediate | undefined;

  constructor(opts: EventLogOptions) {
    this.root = opts.root;
    this.fsyncEach = opts.fsync ?? false;
    mkdirSync(join(this.root, 'sessions'), { recursive: true });
    this.db = new DatabaseSync(join(this.root, 'index.sqlite'));
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        type TEXT NOT NULL,
        item_id TEXT,
        ts TEXT NOT NULL,
        offset INTEGER NOT NULL,
        length INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS ix_events_session ON events(session_id, ts);
      CREATE INDEX IF NOT EXISTS ix_events_type ON events(type);
      CREATE INDEX IF NOT EXISTS ix_events_item ON events(item_id);
      CREATE INDEX IF NOT EXISTS ix_events_ts ON events(ts);
    `);
    this.insert = this.db.prepare(
      'INSERT OR IGNORE INTO events (id, session_id, type, item_id, ts, offset, length) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
  }

  sessionFile(sessionId: string): string {
    assertSessionId(sessionId);
    return join(this.root, 'sessions', sessionId, 'events.jsonl');
  }

  /** 새 기록 구독 (WebSocket 스트리밍 등). 해제 함수를 돌려준다 */
  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** 4.1 이벤트 1개를 원자적으로 추가 (한 번의 write 호출로 한 줄 전체) */
  append(event: LogRecord): LogRecord {
    if (this.closed) throw new Error('EventLog is closed');
    const rec = validate(maskDeep(event));
    const line = Buffer.from(JSON.stringify(rec) + '\n', 'utf8');
    const fd = this.fdFor(rec.sessionId);
    const offset = this.sizes.get(rec.sessionId) ?? fstatSync(fd).size;
    writeAll(fd, line);
    this.sizes.set(rec.sessionId, offset + line.length);
    if (this.fsyncEach) fsyncSafe(fd);
    this.pending.push([rec.id, rec.sessionId, rec.type, rec.itemId ?? null, rec.ts, offset, line.length - 1]);
    if (this.pending.length >= 512) this.flush();
    else this.scheduleFlush();
    for (const fn of this.listeners) {
      try {
        fn(rec);
      } catch {
        // 구독자 오류는 로그 쓰기에 영향을 주지 않는다
      }
    }
    return rec;
  }

  appendMany(events: Iterable<LogRecord>): number {
    let n = 0;
    for (const e of events) {
      this.append(e);
      n++;
    }
    this.flush();
    return n;
  }

  /**
   * 인덱스 대기열을 한 트랜잭션으로 반영한다. JSONL이 원본이고 인덱스는 파생물이므로
   * 비정상 종료 시 잃은 인덱스 행은 rebuildIndex()로 복구한다.
   */
  flush(): void {
    if (this.pending.length === 0) return;
    const rows = this.pending;
    this.pending = [];
    this.db.exec('BEGIN');
    try {
      for (const r of rows) this.insert.run(...r);
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  /** JSONL 원본에서 세션 인덱스를 다시 만든다 */
  rebuildIndex(sessionId: string): number {
    this.flush();
    const file = this.sessionFile(sessionId);
    if (!existsSync(file)) return 0;
    const buf = readFileSync(file);
    this.db.prepare('DELETE FROM events WHERE session_id = ?').run(sessionId);
    let offset = 0;
    let n = 0;
    while (offset < buf.length) {
      let end = buf.indexOf(0x0a, offset);
      if (end < 0) end = buf.length;
      try {
        const rec = JSON.parse(buf.subarray(offset, end).toString('utf8')) as LogRecord;
        this.pending.push([
          rec.id,
          rec.sessionId,
          rec.type,
          rec.itemId ?? null,
          rec.ts,
          offset,
          end - offset,
        ]);
        n++;
      } catch {
        // 잘린 줄은 건너뛴다
      }
      offset = end + 1;
    }
    this.flush();
    return n;
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setImmediate(() => {
      this.flushTimer = undefined;
      if (!this.closed) this.flush();
    });
    this.flushTimer.unref?.();
  }

  /** 4.2 세션 이벤트를 기록 순서대로 재생 */
  async *replay(sessionId: string): AsyncGenerator<LogRecord> {
    const file = this.sessionFile(sessionId);
    if (!existsSync(file)) return;
    const rl = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line) continue;
      try {
        yield JSON.parse(line) as LogRecord;
      } catch {
        // 비정상 종료로 잘린 마지막 줄은 건너뛴다
      }
    }
  }

  /** 4.3 인덱스 조회 → 파일 오프셋에서 원문을 읽어 반환 */
  query(q: EventQuery): LogRecord[] {
    this.flush();
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (q.sessionId) {
      where.push('session_id = ?');
      args.push(q.sessionId);
    }
    if (q.type) {
      where.push('type = ?');
      args.push(q.type);
    }
    if (q.itemId) {
      where.push('item_id = ?');
      args.push(q.itemId);
    }
    if (q.since) {
      where.push('ts >= ?');
      args.push(q.since);
    }
    if (q.until) {
      where.push('ts <= ?');
      args.push(q.until);
    }
    const sql =
      'SELECT session_id, offset, length FROM events' +
      (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
      ' ORDER BY ts, rowid' +
      (q.limit ? ` LIMIT ${Math.max(1, Math.floor(q.limit))}` : '');
    const rows = this.db.prepare(sql).all(...args) as {
      session_id: string;
      offset: number;
      length: number;
    }[];
    return rows.map((r) => this.readAt(r.session_id, r.offset, r.length));
  }

  /** T-101 6B.11 기록 보관 기간: 세션의 이벤트 기록(파일·색인)을 지운다. 지웠으면 true */
  removeSession(sessionId: string): boolean {
    const file = this.sessionFile(sessionId);
    this.flush();
    this.db.prepare('DELETE FROM events WHERE session_id = ?').run(sessionId);
    const dir = dirname(file);
    if (!existsSync(dir)) return false;
    rmSync(dir, { recursive: true, force: true });
    return true;
  }

  /** 세션 목록 */
  sessions(): string[] {
    this.flush();
    const rows = this.db.prepare('SELECT DISTINCT session_id FROM events ORDER BY session_id').all() as {
      session_id: string;
    }[];
    return rows.map((r) => r.session_id);
  }

  close(): void {
    if (this.closed) return;
    this.flush();
    if (this.flushTimer) clearImmediate(this.flushTimer);
    this.closed = true;
    for (const fd of this.fds.values()) closeSync(fd);
    this.fds.clear();
    this.db.close();
  }

  private fdFor(sessionId: string): number {
    let fd = this.fds.get(sessionId);
    if (fd === undefined) {
      const file = this.sessionFile(sessionId);
      mkdirSync(join(file, '..'), { recursive: true });
      fd = openSync(file, 'a+');
      this.fds.set(sessionId, fd);
    }
    return fd;
  }

  private readAt(sessionId: string, offset: number, length: number): LogRecord {
    const fd = this.fdFor(sessionId);
    const buf = Buffer.alloc(length);
    let read = 0;
    while (read < length) {
      const n = readSync(fd, buf, read, length - read, offset + read);
      if (n === 0) break;
      read += n;
    }
    return JSON.parse(buf.toString('utf8')) as LogRecord;
  }
}

function assertSessionId(id: string): void {
  if (!SESSION_ID_RE.test(id) || id === '.' || id === '..') throw new Error(`잘못된 sessionId: ${id}`);
}

function validate(e: LogRecord): LogRecord {
  if (typeof e?.type !== 'string' || !e.type) throw new Error('event.type이 필요합니다');
  if (HARNESS_TYPES.has(e.type)) HarnessEventSchema.parse(e);
  else EventBaseSchema.parse(e);
  assertSessionId(e.sessionId);
  return e;
}

function writeAll(fd: number, buf: Buffer): void {
  let off = 0;
  while (off < buf.length) off += writeSync(fd, buf, off, buf.length - off);
}

function fsyncSafe(fd: number): void {
  try {
    fsyncSync(fd);
  } catch {
    /* 일부 파일시스템은 fsync 미지원 */
  }
}
