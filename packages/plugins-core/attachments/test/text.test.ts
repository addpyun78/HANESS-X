import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { ConversionQueue, convertText, decodeText } from '../src/index.js';
import { makeStore, tempProject } from './helpers.js';
import { cp949Text, eucKrText } from './samples.js';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

describe('1B.2 글 파일: 인코딩 자동 감지(UTF-8/UTF-16/CP949/EUC-KR) → UTF-8', () => {
  it('네 가지 인코딩을 알아보고 같은 글로 읽는다', () => {
    const s = '한글 문서';
    expect(decodeText(Buffer.from(s, 'utf8'))).toMatchObject({ text: s, encoding: 'utf-8' });
    expect(decodeText(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(s)]))).toMatchObject({
      text: s,
      bom: true,
    });
    expect(decodeText(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(s, 'utf16le')]))).toMatchObject({
      text: s,
      encoding: 'utf-16le',
    });
    expect(decodeText(Buffer.from('hello world', 'utf16le'))).toMatchObject({
      text: 'hello world',
      encoding: 'utf-16le',
    });
    expect(decodeText(eucKrText())).toMatchObject({ text: '한글 문서\r\n', encoding: 'euc-kr' });
    expect(decodeText(cp949Text())).toMatchObject({ text: '안녕하세요 똠방각하\n', encoding: 'cp949' });
  });

  it('CP949 한글 파일을 대기열로 넣으면 UTF-8 글 형태가 생긴다', async () => {
    const p = tempProject();
    cleanups.push(p.cleanup);
    const store = makeStore(p.root);
    const q = new ConversionQueue({ store, converters: { text: convertText } });
    const { attachment } = await store.add('s', { name: '옛날메모.txt', data: cp949Text() });
    expect(attachment.kind).toBe('text');
    const done = await q.enqueue(attachment);
    const rep = done.representations.find((r) => r.form === 'text')!;
    expect(rep.mime).toContain('utf-8');
    expect(readFileSync(rep.path, 'utf8')).toBe('안녕하세요 똠방각하\n');
    // 원본 바이트는 그대로
    expect(readFileSync(done.storedPath).equals(cp949Text())).toBe(true);
  });

  it('EUC-KR CRLF는 LF로 정리', async () => {
    const p = tempProject();
    cleanups.push(p.cleanup);
    const store = makeStore(p.root);
    const q = new ConversionQueue({ store, converters: { text: convertText } });
    const { attachment } = await store.add('s', { name: 'a.txt', data: eucKrText() });
    const done = await q.enqueue(attachment);
    expect(readFileSync(done.representations[0]!.path, 'utf8')).toBe('한글 문서\n');
  });
});
