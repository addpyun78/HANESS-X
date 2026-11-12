import { inflateRawSync, inflateSync } from 'node:zlib';
import type { AttachmentWarning, Representation } from '@harness-x/protocol';
import type { Converter } from './context.js';
import { warn, writeRep } from './context.js';
import { MESSAGES } from './messages.js';
import { TOOL_NEEDS } from './tools.js';

/**
 * 1B.3 PDF: 글 추출(직접 구현 — pdf.js 대신, 오프라인), 페이지당 글이 거의 없으면 스캔본으로 보고
 * 안에 든 JPEG 그림을 페이지 그림으로 꺼낸다. tesseract가 PATH에 있으면 한국어 글자 인식.
 * 간단 파서: Flate 스트림의 Tj / TJ / ' / " 연산자 글만 읽는다(글꼴 ToUnicode 표는 안 읽음).
 */

export interface PdfStream {
  dict: string;
  data: Buffer;
}

/** 페이지당 글자가 이보다 적으면 스캔본 */
export const SCANNED_CHARS_PER_PAGE = 20;
export const MAX_PAGE_IMAGES = 50;

export function pdfStreams(buf: Buffer): PdfStream[] {
  const s = buf.toString('latin1');
  const out: PdfStream[] = [];
  const re = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (s.slice(Math.max(0, m.index - 3), m.index) === 'end') continue;
    const objAt = s.lastIndexOf(' obj', m.index);
    if (objAt < 0) continue;
    const dict = s.slice(objAt + 4, m.index);
    const start = m.index + m[0].length;
    const lenM = /\/Length\s+(\d+)\b(?!\s+\d+\s+R)/.exec(dict);
    let end = lenM ? start + Number(lenM[1]) : -1;
    if (end < 0 || end > s.length || !/^\s*endstream/.test(s.slice(end, end + 20)))
      end = s.indexOf('endstream', start);
    if (end < 0) break;
    let data = buf.subarray(start, end);
    if (!lenM)
      while (data.length && (data.at(-1) === 0x0a || data.at(-1) === 0x0d)) data = data.subarray(0, -1);
    out.push({ dict, data: Buffer.from(data) });
    re.lastIndex = end;
  }
  return out;
}

function inflate(b: Buffer): Buffer | undefined {
  try {
    return inflateSync(b);
  } catch {
    try {
      return inflateRawSync(b);
    } catch {
      return undefined;
    }
  }
}

function decodePdfBytes(b: Buffer): string {
  if (b[0] === 0xfe && b[1] === 0xff) {
    const sw = Buffer.from(b.subarray(2));
    sw.swap16();
    return sw.toString('utf16le');
  }
  return b.toString('latin1');
}

/** ( ... ) 글자열 읽기 — 이스케이프·괄호 중첩 처리 */
function readLiteral(s: string, i: number): [Buffer, number] {
  const bytes: number[] = [];
  let depth = 1;
  i++;
  while (i < s.length && depth > 0) {
    const c = s[i]!;
    if (c === '\\') {
      const n = s[i + 1] ?? '';
      const map: Record<string, number> = { n: 10, r: 13, t: 9, b: 8, f: 12, '(': 40, ')': 41, '\\': 92 };
      if (n in map) {
        bytes.push(map[n]!);
        i += 2;
      } else if (/[0-7]/.test(n)) {
        const oct = /^[0-7]{1,3}/.exec(s.slice(i + 1))![0];
        bytes.push(parseInt(oct, 8) & 0xff);
        i += 1 + oct.length;
      } else if (n === '\r' || n === '\n') {
        i += n === '\r' && s[i + 2] === '\n' ? 3 : 2;
      } else {
        i += 2;
      }
      continue;
    }
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (depth > 0) bytes.push(c.charCodeAt(0) & 0xff);
    i++;
  }
  return [Buffer.from(bytes), i];
}

/** 내용 스트림에서 글 뽑기 */
export function extractContentText(content: string): string {
  let out = '';
  const operands: (Buffer | number | (Buffer | number)[])[] = [];
  let arr: (Buffer | number)[] | undefined;
  let i = 0;
  const push = (v: Buffer | number) => (arr ? arr.push(v) : operands.push(v));
  while (i < content.length) {
    const c = content[i]!;
    if (c === '(') {
      const [b, j] = readLiteral(content, i);
      push(b);
      i = j;
    } else if (c === '<' && content[i + 1] !== '<') {
      const j = content.indexOf('>', i);
      const hex = content.slice(i + 1, j < 0 ? content.length : j).replace(/\s+/g, '');
      push(Buffer.from(hex.length % 2 ? hex + '0' : hex, 'hex'));
      i = j < 0 ? content.length : j + 1;
    } else if (c === '[') {
      arr = [];
      i++;
    } else if (c === ']') {
      if (arr) operands.push(arr);
      arr = undefined;
      i++;
    } else if (c === '%') {
      const j = content.indexOf('\n', i);
      i = j < 0 ? content.length : j;
    } else if (/[-+.\d]/.test(c)) {
      const m = /^[-+]?\d*\.?\d+/.exec(content.slice(i, i + 32));
      if (m) {
        push(Number(m[0]));
        i += m[0].length;
      } else i++;
    } else if (/[A-Za-z'"*]/.test(c)) {
      const m = /^[A-Za-z'"*]+/.exec(content.slice(i, i + 16))!;
      const op = m[0];
      i += op.length;
      const last = operands.at(-1);
      if ((op === 'Tj' || op === "'" || op === '"') && Buffer.isBuffer(last)) {
        if (op !== 'Tj') out += '\n';
        out += decodePdfBytes(last);
      } else if (op === 'TJ' && Array.isArray(last)) {
        for (const v of last) out += Buffer.isBuffer(v) ? decodePdfBytes(v) : v < -200 ? ' ' : '';
      } else if (op === 'T*' || op === 'ET') out += '\n';
      else if ((op === 'Td' || op === 'TD') && typeof operands.at(-1) === 'number' && operands.at(-1) !== 0)
        out += '\n';
      operands.length = 0;
    } else i++;
  }
  return out;
}

export interface PdfInfo {
  pages: number;
  text: string;
  /** DCTDecode(JPEG) 그림들 */
  images: Buffer[];
}

export function readPdf(buf: Buffer): PdfInfo {
  const s = buf.toString('latin1');
  const pages = Math.max(1, (s.match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length);
  const images: Buffer[] = [];
  let text = '';
  for (const st of pdfStreams(buf)) {
    const isImage = /\/Subtype\s*\/Image/.test(st.dict);
    if (isImage) {
      if (/\/DCTDecode/.test(st.dict) && st.data[0] === 0xff && st.data[1] === 0xd8) images.push(st.data);
      continue;
    }
    if (
      /\/Length1|\/Length2|\/Type\s*\/(XRef|ObjStm|Metadata|EmbeddedFile)|\/Subtype\s*\/(Type1C|CIDFontType0C|OpenType)/.test(
        st.dict,
      )
    )
      continue;
    const data = /\/FlateDecode/.test(st.dict)
      ? inflate(st.data)
      : /\/Filter/.test(st.dict)
        ? undefined
        : st.data;
    if (!data) continue;
    const t = extractContentText(data.toString('latin1'));
    if (t.trim()) text += t.replace(/\n{2,}/g, '\n');
  }
  return { pages, text: text.replace(/[ \t]+\n/g, '\n').trim(), images };
}

export const convertPdf: Converter = async (_a, data, ctx) => {
  const info = readPdf(data);
  const representations: Representation[] = [];
  const warnings: AttachmentWarning[] = [];
  const chars = info.text.replace(/\s+/g, '').length;
  const scanned = chars / info.pages < SCANNED_CHARS_PER_PAGE;
  let text = info.text;
  if (scanned) {
    warnings.push(warn('scanned-pdf', MESSAGES.scannedPdf));
    const imgs = info.images.slice(0, MAX_PAGE_IMAGES);
    const pageReps = imgs.map((img, i) =>
      writeRep(
        ctx,
        'page-image',
        `pages/page-${String(i + 1).padStart(3, '0')}.jpg`,
        img,
        'image/jpeg',
        i + 1,
      ),
    );
    representations.push(...pageReps);
    const tesseract = ctx.tools.which('tesseract');
    if (tesseract && pageReps.length) {
      const parts: string[] = [];
      for (const r of pageReps) {
        const res = await ctx.tools.run(tesseract, [r.path, 'stdout', '-l', 'kor+eng']);
        if (res.code === 0) parts.push(`## ${r.index}쪽\n\n${res.stdout.toString('utf8').trim()}`);
      }
      if (parts.length) {
        text = parts.join('\n\n');
        warnings.push(warn('ocr', MESSAGES.ocrDone));
      }
    } else if (pageReps.length) {
      warnings.push(warn('tool-needed', MESSAGES.ocrMissing, TOOL_NEEDS.tesseract.capability));
      ctx.onToolNeeded?.({ ...TOOL_NEEDS.tesseract });
    }
  }
  if (text.trim()) representations.unshift(writeRep(ctx, 'text', 'text.md', text + '\n', 'text/markdown'));
  return { representations, warnings };
};
