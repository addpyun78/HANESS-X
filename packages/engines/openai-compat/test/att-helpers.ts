import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { AttachmentStore, ConversionQueue, DEFAULT_CONVERTERS, createZip } from '@harness-x/attachments';
import type { Attachment, HarnessEvent } from '@harness-x/protocol';

/** T-101 1D.4·1D.5 테스트 공용: 실제 저장소에 넣고 바꿔 둔 첨부 3종 */

export const cleanups: (() => unknown)[] = [];

const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);
export function pdf(): Buffer {
  const z = deflateSync(Buffer.from('BT (Quarterly sales report for the Seoul region) Tj ET', 'latin1'));
  return Buffer.concat([
    Buffer.from(
      `%PDF-1.4\n1 0 obj\n<< /Type /Page >>\nendobj\n2 0 obj\n<< /Length ${z.length} /Filter /FlateDecode >>\nstream\n`,
      'latin1',
    ),
    z,
    Buffer.from('\nendstream\nendobj\n%%EOF\n', 'latin1'),
  ]);
}
export function xlsx(): Buffer {
  return createZip([
    {
      name: 'xl/workbook.xml',
      data: '<workbook><sheets><sheet name="매물" r:id="rId1"/></sheets></workbook>',
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    },
    {
      name: 'xl/worksheets/sheet1.xml',
      data: '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>동네</t></is></c><c r="B1"><v>12</v></c></row></sheetData></worksheet>',
    },
  ]);
}

/** 그림·PDF·XLSX 3종을 실제 저장소에 넣고 바꿔 둔다 */
export async function trio(): Promise<{ root: string; list: Attachment[] }> {
  const root = mkdtempSync(join(tmpdir(), 'hx-api-att-'));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const store = new AttachmentStore({ projectRoot: root });
  const q = new ConversionQueue({ store, converters: DEFAULT_CONVERTERS });
  const added = await store.addMany('s', [
    { name: '화면.png', data: PNG },
    { name: '보고서.pdf', data: pdf() },
    { name: '매물.xlsx', data: xlsx() },
  ]);
  const list: Attachment[] = [];
  for (const r of added) list.push(await q.enqueue(r.attachment));
  return { root, list };
}

export async function drain(it: AsyncIterable<HarnessEvent>) {
  const out: HarnessEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

/** 스냅샷용: base64는 앞 12자만, 임시 폴더는 <project> */
export function stable(v: unknown, root: string): unknown {
  return JSON.parse(
    JSON.stringify(v)
      .split(root)
      .join('<project>')
      .replace(/att_[0-9a-f]{12}/g, 'att_<id>')
      .replace(/\/[0-9a-f]{12}\//g, '/<hash12>/')
      .replace(/("data":"|base64,)([A-Za-z0-9+/=]{12})[A-Za-z0-9+/=]*/g, '$1$2…'),
  );
}
