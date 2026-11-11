import { readFileSync, writeFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { MESSAGES, convertPdf, extractContentText, readPdf } from '../src/index.js';
import { addAndConvert, fakeTools, tempProject } from './helpers.js';
import { scannedPdf, textPdf } from './samples.js';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});
const project = () => {
  const p = tempProject();
  cleanups.push(p.cleanup);
  return p.root;
};

describe('1B.3 PDF: 글 추출, 스캔본은 페이지 그림, tesseract가 있으면 글자 인식', () => {
  it('Tj·TJ·이스케이프·UTF-16 글자열을 읽는다', () => {
    expect(extractContentText('BT (Hello \\(world\\)) Tj ET')).toBe('Hello (world)\n');
    expect(extractContentText('BT [(Wo) -30 (rd) -400 (two)] TJ ET')).toBe('Word two\n');
    const utf16 = Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from('한글', 'utf16le').swap16()]);
    expect(extractContentText(`BT <${utf16.toString('hex')}> Tj ET`)).toBe('한글\n');
    expect(extractContentText('BT (a) Tj T* (b) Tj ET')).toBe('a\nb\n');
  });

  it('일반 PDF: 글 형태(text.md)가 생기고 스캔본 안내는 없다', async () => {
    const a = await addAndConvert(project(), '보고서.pdf', textPdf(), { pdf: convertPdf });
    expect(a.kind).toBe('pdf');
    expect(a.status).toBe('ready');
    const text = readFileSync(a.representations.find((r) => r.form === 'text')!.path, 'utf8');
    expect(text).toContain('Annual report 2026 summary');
    expect(text).toContain('Revenue grew by ten percent');
    expect(a.warnings).toEqual([]);
    expect(a.representations.some((r) => r.form === 'page-image')).toBe(false);
  });

  it('스캔 PDF + 글자 인식 도구 없음: 페이지 그림 2장 + 안내 + 도구 찾기 카드', async () => {
    const needs: unknown[] = [];
    const a = await addAndConvert(
      project(),
      '스캔.pdf',
      scannedPdf(2),
      { pdf: convertPdf },
      {
        tools: fakeTools(),
        onToolNeeded: (n) => needs.push(n),
      },
    );
    expect(readPdf(scannedPdf(2)).pages).toBe(2);
    const pages = a.representations.filter((r) => r.form === 'page-image');
    expect(pages.map((p) => p.index)).toEqual([1, 2]);
    expect(readFileSync(pages[0]!.path).subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    expect(a.warnings.map((w) => w.message)).toEqual([MESSAGES.scannedPdf, MESSAGES.ocrMissing]);
    expect(needs).toEqual([expect.objectContaining({ capability: '그림 속 한글 글자 읽기' })]);
  });

  it('스캔 PDF + tesseract 있음: 페이지마다 한국어 인식 결과가 글 형태로', async () => {
    const tools = fakeTools({
      tesseract: (args) => ({ stdout: Buffer.from(`인식한 글 ${args[0]!.match(/page-(\d+)/)![1]}`) }),
    });
    const a = await addAndConvert(project(), '스캔.pdf', scannedPdf(2), { pdf: convertPdf }, { tools });
    expect(tools.calls.map((c) => c.args.slice(1))).toEqual([
      ['stdout', '-l', 'kor+eng'],
      ['stdout', '-l', 'kor+eng'],
    ]);
    const text = readFileSync(a.representations.find((r) => r.form === 'text')!.path, 'utf8');
    expect(text).toContain('## 1쪽');
    expect(text).toContain('인식한 글 002');
    expect(a.warnings.map((w) => w.code)).toEqual(['scanned-pdf', 'ocr']);
  });

  it('망가진 PDF도 원본은 유지 (글 없음 → 스캔본 안내)', async () => {
    const root = project();
    const a = await addAndConvert(root, 'x.pdf', Buffer.from('%PDF-1.4\n%%EOF'), { pdf: convertPdf });
    expect(a.status).toBe('ready');
    writeFileSync(`${root}/ok`, '');
    expect(a.warnings[0]?.code).toBe('scanned-pdf');
  });
});
