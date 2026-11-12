import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readJson, writeFileAtomic } from '../fs-util.js';
import { CHECKLIST_FILE } from '../store.js';
import { ChecklistSchema } from '../schema.js';
import { StageTreeSchema, type StageTree } from './schema.js';
import {
  buildSkeleton,
  syncStageItems,
  TASK_STAGE_ID,
  treeFromChecklist,
  type SkeletonInput,
} from './tree.js';

/**
 * 단계 트리 저장소 (T-101 4A.4)
 * <세션 폴더>/stages.json. 세션 체크리스트(checklist.json)는 그대로 두고, 단계 1개 트리에서는 원장이 하위 항목의 원본이다.
 * - 실행 전에는 트리를 만들지 않는다: start()만 새 트리를 쓴다.
 * - 기존 세션(checklist.json만 있음)은 load() 때 단계 1개 트리로 자동 변환한다.
 */

export const STAGES_FILE = 'stages.json';

export interface StageTreeStoreOptions {
  /** 세션 폴더 (<workspace>/.harness-x/sessions/<id>) */
  dir: string;
  sessionId: string;
  now?: () => Date;
}

export class StageTreeStore {
  readonly file: string;
  constructor(readonly opts: StageTreeStoreOptions) {
    this.file = join(opts.dir, STAGES_FILE);
  }

  exists(): boolean {
    return existsSync(this.file);
  }

  /** 저장된 트리 (없으면 null — 실행 전) */
  read(): StageTree | null {
    if (!existsSync(this.file)) return null;
    return StageTreeSchema.parse(readJson(this.file));
  }

  write(t: StageTree): StageTree {
    const v = StageTreeSchema.parse(t);
    writeFileAtomic(this.file, JSON.stringify(v, null, 2) + '\n');
    return v;
  }

  /** 실행 시작 순간: 에이전트가 정해진 뒤에만 부른다 (에이전트 없으면 단계 1개) */
  start(i: Omit<SkeletonInput, 'sessionId'>): StageTree {
    const ledger = this.readChecklist();
    const items = i.agent ? undefined : (i.items ?? ledger?.items);
    return this.write(
      buildSkeleton({
        ...i,
        sessionId: this.opts.sessionId,
        ...(items ? { items } : {}),
        ...(this.opts.now ? { now: this.opts.now } : {}),
      }),
    );
  }

  /**
   * 트리 읽기 + 마이그레이션: stages.json이 없고 checklist.json이 있으면(기존 세션) 단계 1개 트리로 변환해 저장.
   * 단계 1개 트리는 읽을 때마다 원장 항목과 맞춘다. 둘 다 없으면 null.
   */
  load(): StageTree | null {
    const t = this.read();
    const c = this.readChecklist();
    if (!t) {
      if (!c) return null;
      return this.write(treeFromChecklist(this.opts.sessionId, c, this.opts.now));
    }
    if (c && t.stages.length === 1 && t.stages[0]!.stageId === TASK_STAGE_ID)
      return this.write(syncStageItems(t, TASK_STAGE_ID, c.items, this.opts.now));
    return t;
  }

  private readChecklist() {
    const f = join(this.opts.dir, CHECKLIST_FILE);
    if (!existsSync(f)) return null;
    return ChecklistSchema.parse(readJson(f));
  }
}
