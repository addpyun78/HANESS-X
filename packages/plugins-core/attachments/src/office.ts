import type { Converter } from './context.js';
import { writeRep } from './context.js';
import { attr, blocks, decodeXmlText, textOf } from './xml.js';
import { listZip, readZipEntry, type ZipEntry } from './zip.js';

/**
 * 1B.4 DOCX → Markdown, PPTX → 슬라이드별 글, XLSX → 시트별 표.
 * mammoth·SheetJS 대신 직접 구현(오프라인): ZIP 안 XML에서 글만 뽑는다.
 */

/** 표 한 장의 최대 행 (글 형태가 너무 커지지 않게) */
export const MAX_SHEET_ROWS = 5000;

export function zipText(buf: Buffer, entries: ZipEntry[], name: string): string | undefined {
  const e = entries.find((x) => x.name === name);
  return e ? readZipEntry(buf, e, 64 * 1024 * 1024).toString('utf8') : undefined;
}

const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();

export function markdownTable(rows: string[][]): string {
  if (rows.length === 0) return '';
  const width = Math.max(...rows.map((r) => r.length), 1);
  const pad = (r: string[]) => Array.from({ length: width }, (_v, i) => cell(r[i] ?? ''));
  const [head, ...rest] = rows;
  return [
    `| ${pad(head!).join(' | ')} |`,
    `| ${Array.from({ length: width }, () => '---').join(' | ')} |`,
    ...rest.map((r) => `| ${pad(r).join(' | ')} |`),
  ].join('\n');
}

// ── DOCX ──────────────────────────────────────────────────────
function docxParagraph(p: string): string {
  const text = textOf(p.replace(/<w:tab\/>/g, '<w:t>\t</w:t>'), 'w:t');
  if (!text.trim()) return '';
  const styleTag = /<w:pStyle\b[^>]*>/.exec(p)?.[0];
  const style = styleTag ? (attr(styleTag, 'w:val') ?? '') : '';
  const h = /^(?:Heading|heading|제목)\s*(\d)$/.exec(style) ?? (style === 'Title' ? ['', '1'] : null);
  if (h) return `${'#'.repeat(Math.min(6, Number(h[1])))} ${text.trim()}`;
  if (/<w:numPr>/.test(p)) return `- ${text.trim()}`;
  return text;
}

function docxTable(t: string): string {
  const rows = blocks(t, 'w:tr').map((tr) =>
    blocks(tr, 'w:tc').map((tc) =>
      blocks(tc, 'w:p')
        .map((p) => textOf(p, 'w:t'))
        .join(' '),
    ),
  );
  return markdownTable(rows);
}

export function docxToMarkdown(buf: Buffer): string {
  const entries = listZip(buf);
  const xml = zipText(buf, entries, 'word/document.xml') ?? '';
  const body = /<w:body>([\s\S]*)<\/w:body>/.exec(xml)?.[1] ?? xml;
  const out: string[] = [];
  // 본문 최상위의 문단·표를 순서대로
  const re = /<w:(p|tbl)(?=[\s>])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    const tag = `w:${m[1]}`;
    const block = blocks(body.slice(m.index), tag)[0] ?? '';
    out.push(tag === 'w:tbl' ? docxTable(block) : docxParagraph(block));
    re.lastIndex = m.index + Math.max(block.length, 1);
  }
  return out.filter((x) => x !== '').join('\n\n') + '\n';
}

// ── PPTX ──────────────────────────────────────────────────────
export function pptxToMarkdown(buf: Buffer): string {
  const entries = listZip(buf);
  const slides = entries
    .map((e) => ({ e, n: Number(/^ppt\/slides\/slide(\d+)\.xml$/.exec(e.name)?.[1] ?? NaN) }))
    .filter((x) => !Number.isNaN(x.n))
    .sort((a, b) => a.n - b.n);
  return (
    slides
      .map(({ e, n }) => {
        const xml = readZipEntry(buf, e).toString('utf8');
        const lines = blocks(xml, 'a:p')
          .map((p) => textOf(p, 'a:t').trim())
          .filter(Boolean);
        return [`## 슬라이드 ${n}`, ...lines].join('\n\n');
      })
      .join('\n\n') + '\n'
  );
}

// ── XLSX ──────────────────────────────────────────────────────
export function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? 'A';
  let n = 0;
  for (const c of letters) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

export interface Sheet {
  name: string;
  rows: string[][];
}

export function readXlsx(buf: Buffer): Sheet[] {
  const entries = listZip(buf);
  const wb = zipText(buf, entries, 'xl/workbook.xml') ?? '';
  const rels = zipText(buf, entries, 'xl/_rels/workbook.xml.rels') ?? '';
  const relMap = new Map<string, string>();
  for (const r of rels.match(/<Relationship\b[^>]*>/g) ?? []) {
    const id = attr(r, 'Id');
    const target = attr(r, 'Target');
    if (id && target) relMap.set(id, target.startsWith('/') ? target.slice(1) : `xl/${target}`);
  }
  const ss = zipText(buf, entries, 'xl/sharedStrings.xml') ?? '';
  const shared = blocks(ss, 'si').map((si) => textOf(si.replace(/<rPh\b[\s\S]*?<\/rPh>/g, ''), 't'));
  const sheets: Sheet[] = [];
  const sheetTags = wb.match(/<sheet\b[^>]*>/g) ?? [];
  sheetTags.forEach((tag, i) => {
    const name = attr(tag, 'name') ?? `시트${i + 1}`;
    const rid = attr(tag, 'r:id');
    const path = (rid && relMap.get(rid)) ?? `xl/worksheets/sheet${i + 1}.xml`;
    const xml = zipText(buf, entries, path) ?? '';
    const rows: string[][] = [];
    for (const row of blocks(xml, 'row').slice(0, MAX_SHEET_ROWS)) {
      const r: string[] = [];
      for (const c of row.match(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) ?? []) {
        const open = /^<c\b[^>]*>/.exec(c)![0];
        const ref = attr(open, 'r') ?? '';
        const idx = ref ? columnIndex(ref) : r.length;
        const t = attr(open, 't');
        const v = /<v>([\s\S]*?)<\/v>/.exec(c)?.[1];
        let val = '';
        if (t === 's') val = shared[Number(v)] ?? '';
        else if (t === 'inlineStr') val = textOf(c, 't');
        else if (t === 'b') val = v === '1' ? 'TRUE' : 'FALSE';
        else val = v !== undefined ? decodeXmlText(v) : '';
        r[idx] = val;
      }
      rows.push(Array.from({ length: r.length }, (_v, k) => r[k] ?? ''));
    }
    sheets.push({ name, rows });
  });
  return sheets;
}

export function xlsxToMarkdown(buf: Buffer): string {
  return (
    readXlsx(buf)
      .map((s) => `## 시트: ${s.name}\n\n${s.rows.length ? markdownTable(s.rows) : '(빈 시트)'}`)
      .join('\n\n') + '\n'
  );
}

export const convertDocx: Converter = async (_a, data, ctx) => ({
  representations: [writeRep(ctx, 'text', 'text.md', docxToMarkdown(data), 'text/markdown')],
  warnings: [],
});

export const convertPptx: Converter = async (_a, data, ctx) => ({
  representations: [writeRep(ctx, 'text', 'text.md', pptxToMarkdown(data), 'text/markdown')],
  warnings: [],
});

export const convertXlsx: Converter = async (_a, data, ctx) => ({
  representations: [writeRep(ctx, 'text', 'text.md', xlsxToMarkdown(data), 'text/markdown')],
  warnings: [],
});
