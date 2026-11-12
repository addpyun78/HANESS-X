import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { EventLog } from '@harness-x/kernel';
import { afterEach, describe, expect, it } from 'vitest';
import { ConversionQueue, DEFAULT_CONVERTERS, applySecretChoice, eventLogSink } from '../src/index.js';
import { makeStore, tempProject } from './helpers.js';
import { docx } from './samples.js';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

function allLogText(root: string): string {
  let out = '';
  const walk = (d: string) => {
    for (const n of readdirSync(d, { withFileTypes: true })) {
      const f = join(d, n.name);
      if (n.isDirectory()) walk(f);
      else out += readFileSync(f).toString('utf8');
    }
  };
  walk(root);
  return out;
}

describe('1C.3 첨부 내용은 로그·이벤트에 원문 저장 금지 (경로·해시만)', () => {
  it('넣기·바꾸기·비밀 처리까지 거친 뒤 로그 폴더를 grep해도 내용이 없다', async () => {
    const p = tempProject();
    cleanups.push(p.cleanup);
    const logRoot = join(p.root, 'logs');
    const log = new EventLog({ root: logRoot });
    const events = eventLogSink(log);
    const store = makeStore(p.root, { events });
    const q = new ConversionQueue({ store, converters: DEFAULT_CONVERTERS, events });
    const MARK = '고유표식-집값-7731';
    const inputs = [
      { name: '메모.txt', data: Buffer.from(`${MARK} 첫 줄\n두 번째 줄`) },
      { name: '.env', data: Buffer.from(`PASSWORD=${MARK}-pw\n`) },
      { name: '기획.docx', data: docx([`# ${MARK}`, '본문']) },
    ];
    const added = await store.addMany('sess-1', inputs);
    const done = await Promise.all(added.map((r) => q.enqueue(r.attachment)));
    applySecretChoice(store, done[1]!, 'mask');
    await store.add('sess-1', inputs[0]!); // 재사용 기록
    log.close();

    const text = allLogText(logRoot);
    expect(text).not.toContain(MARK);
    expect(text).not.toContain('두 번째 줄');
    // 경로·해시는 남는다
    for (const a of done) {
      expect(text).toContain(a.sha256);
      expect(text).toContain(JSON.stringify(a.storedPath).slice(1, -1));
    }
    const types = text
      .trim()
      .split('\n')
      .filter((l) => l.startsWith('{'))
      .map((l) => JSON.parse(l).type);
    expect(types).toEqual(
      expect.arrayContaining(['attachment_added', 'attachment_converted', 'attachment_reused']),
    );
  });
});
