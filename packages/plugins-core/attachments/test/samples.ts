import { deflateSync } from 'node:zlib';
import { createZip } from '../src/zip.js';

/** 테스트용 작은 샘플 파일 (코드로 생성) */

const ascii = (s: string) => Buffer.from(s, 'latin1');

export function docx(paragraphs: string[] = ['# 제목', '본문 첫 줄']): Buffer {
  const body = paragraphs
    .map((p) =>
      p.startsWith('# ')
        ? `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>${p.slice(2)}</w:t></w:r></w:p>`
        : `<w:p><w:r><w:t xml:space="preserve">${p}</w:t></w:r></w:p>`,
    )
    .join('');
  const table =
    '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>이름</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>값</w:t></w:r></w:p></w:tc></w:tr>' +
    '<w:tr><w:tc><w:p><w:r><w:t>가</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>1</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';
  return createZip([
    { name: '[Content_Types].xml', data: '<Types/>' },
    {
      name: 'word/document.xml',
      data: `<?xml version="1.0"?><w:document xmlns:w="w"><w:body>${body}${table}</w:body></w:document>`,
    },
  ]);
}

export function pptx(slides: string[][] = [['첫 장 제목', '첫 장 내용'], ['둘째 장']]): Buffer {
  return createZip([
    { name: '[Content_Types].xml', data: '<Types/>' },
    ...slides.map((texts, i) => ({
      name: `ppt/slides/slide${i + 1}.xml`,
      data: `<p:sld xmlns:a="a" xmlns:p="p"><p:cSld><p:spTree>${texts
        .map((t) => `<p:sp><p:txBody><a:p><a:r><a:t>${t}</a:t></a:r></a:p></p:txBody></p:sp>`)
        .join('')}</p:spTree></p:cSld></p:sld>`,
    })),
  ]);
}

/** 시트 이름 → 행(문자열 배열) */
export function xlsx(sheets: Record<string, (string | number)[][]>): Buffer {
  const shared: string[] = [];
  const sIndex = (s: string) => {
    let i = shared.indexOf(s);
    if (i < 0) i = shared.push(s) - 1;
    return i;
  };
  const names = Object.keys(sheets);
  const sheetXml = names.map((n) => {
    const rows = sheets[n]!.map(
      (r, ri) =>
        `<row r="${ri + 1}">${r
          .map((v, ci) => {
            const ref = `${String.fromCharCode(65 + ci)}${ri + 1}`;
            return typeof v === 'number'
              ? `<c r="${ref}"><v>${v}</v></c>`
              : `<c r="${ref}" t="s"><v>${sIndex(v)}</v></c>`;
          })
          .join('')}</row>`,
    );
    return `<worksheet><sheetData>${rows.join('')}</sheetData></worksheet>`;
  });
  return createZip([
    { name: '[Content_Types].xml', data: '<Types/>' },
    {
      name: 'xl/workbook.xml',
      data: `<workbook xmlns:r="r"><sheets>${names
        .map((n, i) => `<sheet name="${n}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
        .join('')}</sheets></workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: `<Relationships>${names
        .map(
          (_n, i) =>
            `<Relationship Id="rId${i + 1}" Type="http://schemas/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
        )
        .join('')}</Relationships>`,
    },
    {
      name: 'xl/sharedStrings.xml',
      data: `<sst>${shared.map((s) => `<si><t>${s}</t></si>`).join('')}</sst>`,
    },
    ...sheetXml.map((x, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: x })),
  ]);
}

export function hwpx(paragraphs: string[] = ['한글 기획서', '두 번째 문단']): Buffer {
  return createZip([
    { name: 'mimetype', data: 'application/hwp+zip', store: true },
    { name: 'Contents/content.hpf', data: '<opf/>' },
    {
      name: 'Contents/section0.xml',
      data: `<hs:sec xmlns:hp="hp" xmlns:hs="hs">${paragraphs
        .map((p) => `<hp:p><hp:run><hp:t>${p}</hp:t></hp:run></hp:p>`)
        .join('')}</hs:sec>`,
    },
  ]);
}

/** OLE 머리 + "HWP Document File" */
export function hwp(): Buffer {
  const b = Buffer.alloc(2048);
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(b, 0);
  ascii('HWP Document File').copy(b, 1024);
  return b;
}

/** 글이 있는 PDF (Flate 스트림 안 Tj/TJ) */
export function textPdf(
  lines: string[] = ['Annual report 2026 summary', 'Revenue grew by ten percent'],
  pages = 1,
): Buffer {
  const pageObjs: Buffer[] = [];
  const parts: Buffer[] = [ascii('%PDF-1.4\n')];
  for (let p = 0; p < pages; p++) {
    const content = lines
      .map((l, i) => (i % 2 ? `BT [(${l.slice(0, 3)}) -20 (${l.slice(3)})] TJ ET` : `BT (${l}) Tj ET`))
      .join('\n');
    const z = deflateSync(Buffer.from(content, 'latin1'));
    pageObjs.push(
      Buffer.concat([
        ascii(`${p * 2 + 1} 0 obj\n<< /Type /Page /Contents ${p * 2 + 2} 0 R >>\nendobj\n`),
        ascii(`${p * 2 + 2} 0 obj\n<< /Length ${z.length} /Filter /FlateDecode >>\nstream\n`),
        z,
        ascii('\nendstream\nendobj\n'),
      ]),
    );
  }
  parts.push(...pageObjs, ascii('%%EOF\n'));
  return Buffer.concat(parts);
}

/** 글이 없고 JPEG 그림만 있는 PDF (스캔본) */
export function scannedPdf(pages = 2): Buffer {
  const parts: Buffer[] = [ascii('%PDF-1.4\n')];
  for (let p = 0; p < pages; p++) {
    const img = jpeg();
    parts.push(
      ascii(
        `${p * 2 + 1} 0 obj\n<< /Type /Page /Resources << /XObject << /Im0 ${p * 2 + 2} 0 R >> >> >>\nendobj\n`,
      ),
      ascii(
        `${p * 2 + 2} 0 obj\n<< /Type /XObject /Subtype /Image /Width 8 /Height 8 /Filter /DCTDecode /Length ${img.length} >>\nstream\n`,
      ),
      img,
      ascii('\nendstream\nendobj\n'),
    );
  }
  parts.push(ascii('%%EOF\n'));
  return Buffer.concat(parts);
}

/** PNG (IHDR 포함, 선택적으로 tEXt·eXIf 청크) */
export function png(o: { width?: number; height?: number; meta?: boolean } = {}): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    return Buffer.concat([len, ascii(type), data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(o.width ?? 4, 0);
  ihdr.writeUInt32BE(o.height ?? 3, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    ...(o.meta ? [chunk('tEXt', ascii('Comment\0GPS 37.5665 126.9780')), chunk('eXIf', exifGps())] : []),
    chunk('IDAT', deflateSync(Buffer.alloc(16))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** EXIF(TIFF) 본문 — GPS 태그 흔적이 들어 있음 */
export function exifGps(): Buffer {
  return Buffer.concat([ascii('MM\0*\0\0\0\x08'), ascii('GPSLatitude 37.5665 GPSLongitude 126.9780')]);
}

/** JPEG (선택적으로 APP1 Exif GPS) */
export function jpeg(o: { width?: number; height?: number; gps?: boolean } = {}): Buffer {
  const seg = (marker: number, data: Buffer) => {
    const h = Buffer.alloc(4);
    h[0] = 0xff;
    h[1] = marker;
    h.writeUInt16BE(data.length + 2, 2);
    return Buffer.concat([h, data]);
  };
  const sof = Buffer.alloc(15);
  sof[0] = 8;
  sof.writeUInt16BE(o.height ?? 8, 1);
  sof.writeUInt16BE(o.width ?? 8, 3);
  sof[5] = 3;
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    seg(0xe0, ascii('JFIF\0\x01\x01\0\0\x01\0\x01\0\0')),
    ...(o.gps ? [seg(0xe1, Buffer.concat([ascii('Exif\0\0'), exifGps()]))] : []),
    seg(0xc0, sof),
    seg(0xda, Buffer.from([1, 1, 0, 0, 0x3f, 0])),
    Buffer.from([0x12, 0x34, 0x56, 0xff, 0xd9]),
  ]);
}

export function wav(): Buffer {
  const b = Buffer.alloc(44);
  ascii('RIFF').copy(b, 0);
  b.writeUInt32LE(36, 4);
  ascii('WAVEfmt ').copy(b, 8);
  return b;
}

export const mp3 = () => Buffer.concat([ascii('ID3\x03\0\0\0\0\0\0'), Buffer.alloc(32)]);
export const ogg = () => Buffer.concat([ascii('OggS\0\x02'), Buffer.alloc(32)]);
export const mp4 = () =>
  Buffer.concat([Buffer.from([0, 0, 0, 0x18]), ascii('ftypisom\0\0\x02\0isomiso2'), Buffer.alloc(32)]);
export const m4a = () =>
  Buffer.concat([Buffer.from([0, 0, 0, 0x18]), ascii('ftypM4A \0\0\0\0'), Buffer.alloc(32)]);
export const webm = () =>
  Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), ascii('\x9f\x42\x82\x84webm'), Buffer.alloc(16)]);
export const gif = () => Buffer.concat([ascii('GIF89a'), Buffer.alloc(16)]);
export const webp = () => Buffer.concat([ascii('RIFF\x20\0\0\0WEBPVP8 '), Buffer.alloc(16)]);
export const gzip = () => Buffer.from([0x1f, 0x8b, 0x08, 0, 0, 0, 0, 0, 0, 3, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
export const sevenZip = () =>
  Buffer.concat([Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c, 0, 4]), Buffer.alloc(24)]);
export const exe = () => Buffer.concat([ascii('MZ\x90\0'), Buffer.alloc(60)]);
export const elf = () => Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]), Buffer.alloc(32)]);

/** tar: 파일 이름 → 내용 */
export function tar(files: Record<string, string>): Buffer {
  const blocks: Buffer[] = [];
  for (const [name, body] of Object.entries(files)) {
    const h = Buffer.alloc(512);
    h.write(name, 0, 100, 'utf8');
    h.write('0000644\0', 100, 'latin1');
    h.write(Buffer.byteLength(body).toString(8).padStart(11, '0') + '\0', 124, 'latin1');
    h.write('0', 156, 'latin1');
    h.write('ustar\0' + '00', 257, 'latin1');
    blocks.push(h);
    const data = Buffer.alloc(Math.ceil(Buffer.byteLength(body) / 512) * 512);
    data.write(body, 0, 'utf8');
    blocks.push(data);
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}

/** CP949 한글 글 ("똠방각하" 같은 확장 완성형 포함) */
export function cp949Text(): Buffer {
  // "안녕하세요 똠방각하\n" — 똠(0x8C 0x63)은 EUC-KR 밖 CP949 확장 영역
  return Buffer.from([
    0xbe, 0xc8, 0xb3, 0xe7, 0xc7, 0xcf, 0xbc, 0xbc, 0xbf, 0xe4, 0x20, 0x8c, 0x63, 0xb9, 0xe6, 0xb0, 0xa2,
    0xc7, 0xcf, 0x0a,
  ]);
}

/** EUC-KR 한글 글 ("한글 문서") */
export function eucKrText(): Buffer {
  return Buffer.from([0xc7, 0xd1, 0xb1, 0xdb, 0x20, 0xb9, 0xae, 0xbc, 0xad, 0x0d, 0x0a]);
}

/** 보통 zip (안에 글 파일 2개) */
export function createZipPlain(): Buffer {
  return createZip([
    { name: 'docs/a.txt', data: '가나다' },
    { name: 'b.md', data: '# b' },
  ]);
}
