import { readdirSync, statSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { makeStore, tempProject } from './helpers.js';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

describe('1A.6 같은 파일(같은 해시)은 다시 저장하지 않고 재사용', () => {
  it('같은 내용을 이름만 바꿔 두 번 넣어도 폴더·원본은 하나, 기록은 처음 것', async () => {
    const p = tempProject();
    cleanups.push(p.cleanup);
    const events: Record<string, unknown>[] = [];
    const store = makeStore(p.root, { events: { append: (r) => events.push(r) } });
    const first = await store.add('s', { name: '보고서.txt', data: Buffer.from('같은 내용') });
    const mtime = statSync(first.attachment.storedPath).mtimeMs;
    const again = await store.add('s', { name: '보고서-복사본.txt', data: Buffer.from('같은 내용') });
    expect(first.reused).toBe(false);
    expect(again.reused).toBe(true);
    expect(again.attachment.id).toBe(first.attachment.id);
    expect(again.attachment.originalName).toBe('보고서.txt');
    expect(statSync(first.attachment.storedPath).mtimeMs).toBe(mtime);
    expect(readdirSync(store.dir('s'))).toHaveLength(1);
    expect(events.map((e) => e.type)).toEqual(['attachment_added', 'attachment_reused']);
  });

  it('내용이 한 글자라도 다르면 따로 저장', async () => {
    const p = tempProject();
    cleanups.push(p.cleanup);
    const store = makeStore(p.root);
    const a = await store.add('s', { name: 'a.txt', data: Buffer.from('내용1') });
    const b = await store.add('s', { name: 'a.txt', data: Buffer.from('내용2') });
    expect(a.attachment.id).not.toBe(b.attachment.id);
    expect(store.list('s')).toHaveLength(2);
  });
});
