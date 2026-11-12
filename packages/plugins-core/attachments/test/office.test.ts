import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { convertDocx, convertPptx, convertXlsx, readXlsx } from '../src/index.js';
import { addAndConvert, tempProject } from './helpers.js';
import { docx, pptx, xlsx } from './samples.js';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});
const project = () => {
  const p = tempProject();
  cleanups.push(p.cleanup);
  return p.root;
};
const textOf = (a: { representations: { form: string; path: string }[] }) =>
  readFileSync(a.representations.find((r) => r.form === 'text')!.path, 'utf8');

const converters = { docx: convertDocx, pptx: convertPptx, xlsx: convertXlsx };

describe('1B.4 DOCX → Markdown, PPTX → 슬라이드별 글, XLSX → 시트별 표 (직접 구현)', () => {
  it('DOCX: 제목은 #, 문단, 표는 Markdown 표', async () => {
    const a = await addAndConvert(
      project(),
      '기획.docx',
      docx(['# 집값 분석', '서울 &amp; 경기 비교']),
      converters,
    );
    expect(a.kind).toBe('docx');
    const md = textOf(a);
    expect(md).toBe('# 집값 분석\n\n서울 & 경기 비교\n\n| 이름 | 값 |\n| --- | --- |\n| 가 | 1 |\n');
  });

  it('PPTX: 슬라이드 번호 순서대로 글', async () => {
    const slides = Array.from({ length: 11 }, (_v, i) => [`장 ${i + 1}`]);
    const a = await addAndConvert(project(), '발표.pptx', pptx(slides), converters);
    const md = textOf(a);
    expect(md.startsWith('## 슬라이드 1\n\n장 1\n\n## 슬라이드 2\n\n장 2')).toBe(true);
    expect(md.indexOf('## 슬라이드 10')).toBeGreaterThan(md.indexOf('## 슬라이드 9'));
  });

  it('XLSX: 3개 시트 → 시트별 표 (공유 문자열·숫자)', async () => {
    const book = xlsx({
      매물: [
        ['동네', '가격'],
        ['마포', 12],
      ],
      시세: [
        ['월', '평균'],
        ['1월', 3.5],
      ],
      메모: [['비고 | 주의']],
    });
    expect(readXlsx(book).map((s) => s.name)).toEqual(['매물', '시세', '메모']);
    const md = textOf(await addAndConvert(project(), '매물.xlsx', book, converters));
    expect(md).toContain('## 시트: 매물\n\n| 동네 | 가격 |\n| --- | --- |\n| 마포 | 12 |');
    expect(md).toContain('## 시트: 시세\n\n| 월 | 평균 |\n| --- | --- |\n| 1월 | 3.5 |');
    expect(md).toContain('| 비고 \\| 주의 |');
  });
});
