import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChecklistLedger, ChecklistSchema, ChecklistStore } from '@harness-x/checklist-ledger';
import { afterEach, describe, expect, it } from 'vitest';
import { migrateChecklistCompare } from '../src/migrate.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function seed() {
  const dir = mkdtempSync(join(tmpdir(), 'hx-cmp-migrate-'));
  dirs.push(dir);
  const l = new ChecklistLedger({ dir, sessionId: 's1' });
  l.create([
    { id: '1', title: '빌드', artifactId: 'art.build', acceptance: [{ type: 'command', run: 'pnpm build' }] },
    {
      id: '2',
      title: '버전 출력',
      artifactId: 'art.cli',
      acceptance: [{ type: 'command', run: 'hx --version', expectOutput: 'v1.2' }, { type: 'file_exists' }],
    },
    {
      id: '3',
      title: '로그인 화면',
      artifactId: 'art.login',
      acceptance: [
        { type: 'symbol', symbol: 'LoginScreen' },
        { type: 'schema', requiredKeys: ['name'] },
        { type: 'llm', prompt: '화면이 자연스러운가' },
        { type: 'test', run: 'pnpm test login', compare: { kind: 'exact', semantic: 'off' } },
      ],
    },
  ]);
  l.transition('1', 'doing');
  l.transition('1', 'verifying');
  l.transition('1', 'done', { evidence: { kind: 'command', summary: 'exit 0' } });
  l.transition('2', 'blocked');
  return { dir, store: new ChecklistStore({ dir }) };
}

describe('D.5 기존 체크리스트 마이그레이션', () => {
  it('compare 없는 조건을 D.2로 채우고, 원본은 checklist.v-before-T100.json 보관, 항목 수·상태 동일', () => {
    const { dir, store } = seed();
    const before = store.read()!;
    const r = migrateChecklistCompare(store);
    expect(r).toMatchObject({ migrated: true, filled: 5 });
    expect(r.backup).toBe(join(dir, 'checklist.v-before-T100.json'));
    const backup = ChecklistSchema.parse(JSON.parse(readFileSync(r.backup!, 'utf8')));
    expect(backup).toEqual(before);
    const after = store.read()!;
    expect(after.items.length).toBe(before.items.length);
    expect(after.items.map((i) => [i.id, i.status, i.attempts, i.evidence.length])).toEqual(
      before.items.map((i) => [i.id, i.status, i.attempts, i.evidence.length]),
    );
    expect(after.revision).toBe(before.revision);
    const specs = after.items.flatMap((i) =>
      i.acceptance.map((a) => ('compare' in a ? a.compare : undefined)),
    );
    expect(specs).toEqual([
      { kind: 'exitCode' },
      { kind: 'version' },
      { kind: 'path' },
      { kind: 'text', options: { mode: 'contains' } },
      { kind: 'json' },
      undefined,
      { kind: 'exact', semantic: 'off' },
    ]);
  });
  it('다시 실행하면 아무것도 바꾸지 않는다 (보관본도 그대로)', () => {
    const { store } = seed();
    const first = migrateChecklistCompare(store);
    const v = store.version();
    const again = migrateChecklistCompare(store);
    expect(again).toMatchObject({ migrated: false, filled: 0 });
    expect(store.version()).toBe(v);
    expect(existsSync(first.backup!)).toBe(true);
  });
});
