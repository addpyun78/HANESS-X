import { describe, expect, it } from 'vitest';
import { detectType } from '../src/index.js';
import * as s from './samples.js';

/** [설명, 내용, 일부러 틀리게 붙인 이름, 기대 종류, 기대 mime] */
const RENAMED: [string, () => Buffer, string, string, string][] = [
  ['PDF', () => s.textPdf(), '보고서.txt', 'pdf', 'application/pdf'],
  [
    'DOCX',
    () => s.docx(),
    '문서.zip',
    'docx',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ],
  [
    'PPTX',
    () => s.pptx(),
    '발표.docx',
    'pptx',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ],
  [
    'XLSX',
    () => s.xlsx({ 시트1: [['a']] }),
    '표.pdf',
    'xlsx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ],
  ['HWPX', () => s.hwpx(), '기획서.zip', 'hwpx', 'application/hwp+zip'],
  ['HWP', () => s.hwp(), '옛문서.doc', 'hwp', 'application/x-hwp'],
  ['PNG', () => s.png(), '사진.jpg', 'image', 'image/png'],
  ['JPEG', () => s.jpeg(), '사진.png', 'image', 'image/jpeg'],
  ['GIF', () => s.gif(), '움짤.bin', 'image', 'image/gif'],
  ['WEBP', () => s.webp(), '그림.png', 'image', 'image/webp'],
  ['WAV', () => s.wav(), '녹음.mp3', 'audio', 'audio/wav'],
  ['MP3', () => s.mp3(), '노래.wav', 'audio', 'audio/mpeg'],
  ['OGG', () => s.ogg(), '소리.txt', 'audio', 'audio/ogg'],
  ['M4A', () => s.m4a(), '음성.mp4', 'audio', 'audio/mp4'],
  ['MP4', () => s.mp4(), '영상.mp3', 'video', 'video/mp4'],
  ['WEBM', () => s.webm(), '영상.mp4', 'video', 'video/webm'],
  ['ZIP', () => s.createZipPlain(), '자료.docx', 'archive', 'application/zip'],
  ['GZIP', () => s.gzip(), '묶음.txt', 'archive', 'application/gzip'],
  ['TAR', () => s.tar({ 'a.txt': 'a' }), '묶음.jpg', 'archive', 'application/x-tar'],
  ['7Z', () => s.sevenZip(), '묶음.zip', 'archive', 'application/x-7z-compressed'],
  ['EXE', () => s.exe(), '설명서.pdf', 'executable', 'application/vnd.microsoft.portable-executable'],
  ['ELF', () => s.elf(), '데이터.csv', 'executable', 'application/x-elf'],
  ['CP949 글', () => s.cp949Text(), '메모.png', 'text', 'text/plain'],
];

describe('1A.4 종류 인식: 매직 바이트 우선, 확장자 보조', () => {
  it(`확장자를 바꾼 파일 ${RENAMED.length}종을 내용으로 알아본다`, () => {
    expect(RENAMED.length).toBeGreaterThanOrEqual(20);
    for (const [label, make, name, kind, mime] of RENAMED) {
      const d = detectType(make(), name);
      expect({ label, kind: d.kind, mime: d.mime }).toEqual({ label, kind, mime });
    }
  });

  it('글 파일은 확장자로 세부 형식을 고른다 (보조)', () => {
    expect(detectType(Buffer.from('# 제목'), 'a.md')).toMatchObject({ kind: 'text', mime: 'text/markdown' });
    expect(detectType(Buffer.from('a,b\n1,2'), 'a.csv')).toMatchObject({ kind: 'text', mime: 'text/csv' });
    expect(detectType(Buffer.from('{"a":1}'), 'a.json')).toMatchObject({ mime: 'application/json' });
    expect(detectType(Buffer.from('echo hi'), 'run.sh')).toMatchObject({ kind: 'executable' });
    expect(detectType(Buffer.from('#!/bin/sh\necho hi'), 'run.txt')).toMatchObject({ kind: 'executable' });
    // UTF-16 BOM 글은 mp3로 오인하지 않는다
    expect(detectType(Buffer.from([0xff, 0xfe, 0x48, 0, 0x69, 0]), 'a.txt').kind).toBe('text');
  });

  it('PNG 확장자인데 내용이 글이면 글, 바이너리인데 매직이 없으면 알 수 없음', () => {
    expect(detectType(Buffer.from('그냥 글'), 'fake.png').kind).toBe('text');
    const junk = Buffer.from(Array.from({ length: 256 }, (_v, i) => (i * 7) % 256));
    expect(detectType(junk, 'data.pdf')).toMatchObject({ kind: 'unknown', mime: 'application/octet-stream' });
  });
});
