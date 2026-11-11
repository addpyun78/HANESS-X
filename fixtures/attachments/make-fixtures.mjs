// T-101 1F.1 첨부 회귀 픽스처 생성기 (새 패키지 없이 node 내장만).
// 실행: node fixtures/attachments/make-fixtures.mjs  → fixtures/attachments/files/ 아래 작은 파일 21종
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync, deflateSync, gzipSync } from 'node:zlib';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'files');
const latin = (s) => Buffer.from(s, 'latin1');

function zip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const f of files) {
    const raw = typeof f.data === 'string' ? Buffer.from(f.data, 'utf8') : f.data;
    const method = f.store ? 0 : 8;
    const body = method === 8 ? deflateRawSync(raw) : raw;
    const name = Buffer.from(f.name, 'utf8');
    const crc = crc32(raw);
    const loc = Buffer.alloc(30);
    loc.writeUInt32LE(0x04034b50, 0);
    loc.writeUInt16LE(20, 4);
    loc.writeUInt16LE(0x800, 6);
    loc.writeUInt16LE(method, 8);
    loc.writeUInt32LE(crc, 14);
    loc.writeUInt32LE(body.length, 18);
    loc.writeUInt32LE(raw.length, 22);
    loc.writeUInt16LE(name.length, 26);
    locals.push(loc, name, body);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0x800, 8);
    cen.writeUInt16LE(method, 10);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(body.length, 20);
    cen.writeUInt32LE(raw.length, 24);
    cen.writeUInt16LE(name.length, 28);
    cen.writeUInt32LE(offset, 42);
    centrals.push(cen, name);
    offset += loc.length + name.length + body.length;
  }
  const cenBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cenBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cenBuf, eocd]);
}

function jpeg({ width = 8, height = 8, gps = false } = {}) {
  const seg = (marker, data) => {
    const h = Buffer.alloc(4);
    h[0] = 0xff;
    h[1] = marker;
    h.writeUInt16BE(data.length + 2, 2);
    return Buffer.concat([h, data]);
  };
  const sof = Buffer.alloc(15);
  sof[0] = 8;
  sof.writeUInt16BE(height, 1);
  sof.writeUInt16BE(width, 3);
  sof[5] = 3;
  const exif = Buffer.concat([
    latin('Exif\0\0MM\0*\0\0\0\x08'),
    latin('GPSLatitude 37.5665 GPSLongitude 126.9780'),
  ]);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    seg(0xe0, latin('JFIF\0\x01\x01\0\0\x01\0\x01\0\0')),
    ...(gps ? [seg(0xe1, exif)] : []),
    seg(0xc0, sof),
    seg(0xda, Buffer.from([1, 1, 0, 0, 0x3f, 0])),
    Buffer.from([0x12, 0x34, 0x56, 0xff, 0xd9]),
  ]);
}

function png({ meta = false } = {}) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([latin(type), data])));
    return Buffer.concat([len, latin(type), data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(4, 0);
  ihdr.writeUInt32BE(3, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    ...(meta
      ? [
          chunk('tEXt', latin('Comment\0GPS 37.5665 126.9780')),
          chunk('eXIf', latin('MM\0*\0\0\0\x08GPSLatitude')),
        ]
      : []),
    chunk('IDAT', deflateSync(Buffer.alloc(40))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function textPdf() {
  const content = 'BT (Annual report 2026 summary) Tj ET\nBT [(Rev) -20 (enue grew by ten percent)] TJ ET';
  const z = deflateSync(latin(content));
  return Buffer.concat([
    latin('%PDF-1.4\n1 0 obj\n<< /Type /Page /Contents 2 0 R >>\nendobj\n'),
    latin(`2 0 obj\n<< /Length ${z.length} /Filter /FlateDecode >>\nstream\n`),
    z,
    latin('\nendstream\nendobj\n%%EOF\n'),
  ]);
}

function scannedPdf() {
  const parts = [latin('%PDF-1.4\n')];
  for (let p = 0; p < 2; p++) {
    const img = jpeg();
    parts.push(
      latin(
        `${p * 2 + 1} 0 obj\n<< /Type /Page /Resources << /XObject << /Im0 ${p * 2 + 2} 0 R >> >> >>\nendobj\n`,
      ),
      latin(
        `${p * 2 + 2} 0 obj\n<< /Type /XObject /Subtype /Image /Width 8 /Height 8 /Filter /DCTDecode /Length ${img.length} >>\nstream\n`,
      ),
      img,
      latin('\nendstream\nendobj\n'),
    );
  }
  parts.push(latin('%%EOF\n'));
  return Buffer.concat(parts);
}

function xlsx() {
  const sheets = {
    매물: [
      ['동네', '가격(억)'],
      ['마포', '12'],
      ['성동', '14'],
    ],
    시세: [
      ['월', '평균'],
      ['1월', '3.5'],
    ],
    메모: [['비고'], ['역세권 우선']],
  };
  const shared = [];
  const si = (s) => (shared.includes(s) ? shared.indexOf(s) : shared.push(s) - 1);
  const names = Object.keys(sheets);
  const sheetXml = names.map(
    (n) =>
      `<worksheet><sheetData>${sheets[n]
        .map(
          (r, ri) =>
            `<row r="${ri + 1}">${r
              .map((v, ci) => `<c r="${String.fromCharCode(65 + ci)}${ri + 1}" t="s"><v>${si(v)}</v></c>`)
              .join('')}</row>`,
        )
        .join('')}</sheetData></worksheet>`,
  );
  return zip([
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
        .map((_n, i) => `<Relationship Id="rId${i + 1}" Target="worksheets/sheet${i + 1}.xml"/>`)
        .join('')}</Relationships>`,
    },
    {
      name: 'xl/sharedStrings.xml',
      data: `<sst>${shared.map((s) => `<si><t>${s}</t></si>`).join('')}</sst>`,
    },
    ...sheetXml.map((x, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: x })),
  ]);
}

function tar(files) {
  const blocks = [];
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

const hwp = Buffer.alloc(2048);
Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(hwp, 0);
latin('HWP Document File').copy(hwp, 1024);

const FILES = {
  // 글
  'cp949.txt': Buffer.from([
    0xbe, 0xc8, 0xb3, 0xe7, 0xc7, 0xcf, 0xbc, 0xbc, 0xbf, 0xe4, 0x20, 0x8c, 0x63, 0xb9, 0xe6, 0xb0, 0xa2,
    0xc7, 0xcf, 0x0a,
  ]),
  'utf16.txt': Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('유니코드 메모\n', 'utf16le')]),
  'sample.env': 'DB_HOST=localhost\nDB_PASSWORD=hunter2-fixture\nOPENAI_KEY=sk-fixtureabcdefghijklmnop12\n',
  'run.sh': '#!/bin/sh\necho "실행하면 안 돼요"\n',
  // 문서
  'report.pdf': textPdf(),
  'scanned.pdf': scannedPdf(),
  'plan.hwpx': zip([
    { name: 'mimetype', data: 'application/hwp+zip', store: true },
    {
      name: 'Contents/section0.xml',
      data: '<hs:sec><hp:p><hp:run><hp:t>한글 기획서</hp:t></hp:run></hp:p><hp:p><hp:run><hp:t>목표: 집값 분석 화면</hp:t></hp:run></hp:p></hs:sec>',
    },
  ]),
  'old.hwp': hwp,
  'three-sheets.xlsx': xlsx(),
  'memo.docx': zip([
    { name: '[Content_Types].xml', data: '<Types/>' },
    {
      name: 'word/document.xml',
      data: '<w:document><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>회의록</w:t></w:r></w:p><w:p><w:r><w:t>다음 주까지 화면 시안</w:t></w:r></w:p></w:body></w:document>',
    },
  ]),
  'deck.pptx': zip([
    { name: '[Content_Types].xml', data: '<Types/>' },
    { name: 'ppt/slides/slide1.xml', data: '<p:sld><a:p><a:r><a:t>첫 장</a:t></a:r></a:p></p:sld>' },
    { name: 'ppt/slides/slide2.xml', data: '<p:sld><a:p><a:r><a:t>둘째 장</a:t></a:r></a:p></p:sld>' },
  ]),
  // 그림·소리·동영상
  'gps.jpg': jpeg({ gps: true }),
  'meta.png': png({ meta: true }),
  'disguised.txt': png(),
  'voice.wav': Buffer.concat([latin('RIFF$\0\0\0WAVEfmt '), Buffer.alloc(32)]),
  'clip.mp4': Buffer.concat([
    Buffer.from([0, 0, 0, 0x18]),
    latin('ftypisom\0\0\x02\0isomiso2'),
    Buffer.alloc(32),
  ]),
  // 압축
  'bomb.zip': zip([{ name: 'zeros.bin', data: Buffer.alloc(20 * 1024 * 1024) }]),
  'traversal.zip': zip([
    { name: 'ok.txt', data: '정상' },
    { name: '../../evil.txt', data: '폴더 밖에 쓰기' },
  ]),
  'bundle.tar.gz': gzipSync(tar({ 'a.txt': '가', 'docs/b.md': '# 비' })),
  // 실행 파일·알 수 없음
  'setup.exe': Buffer.concat([latin('MZ\x90\0'), Buffer.alloc(60)]),
  'unknown.bin': Buffer.from(Array.from({ length: 64 }, (_v, i) => (i * 37 + 1) % 256)),
};

mkdirSync(OUT, { recursive: true });
for (const [name, data] of Object.entries(FILES)) writeFileSync(join(OUT, name), data);
console.log(`wrote ${Object.keys(FILES).length} fixtures to ${OUT}`);
