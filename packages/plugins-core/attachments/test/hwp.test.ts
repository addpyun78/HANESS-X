import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  MESSAGES,
  convertHwp,
  convertHwpx,
  createZip,
  hwpxToMarkdown,
  toolFinderBridge,
} from '../src/index.js';
import { addAndConvert, fakeTools, tempProject } from './helpers.js';
import { hwp, hwpx } from './samples.js';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});
const project = () => {
  const p = tempProject();
  cleanups.push(p.cleanup);
  return p.root;
};
const converters = { hwpx: convertHwpx, hwp: convertHwp };

describe('1B.5 HWPX 글 추출 / HWP는 hwp5txt가 있으면, 없으면 도구 찾기 카드', () => {
  it('HWPX 샘플: 문단 순서대로 글, 표는 Markdown 표', async () => {
    const a = await addAndConvert(
      project(),
      '기획서.hwpx',
      hwpx(['한글 기획서', '목표: 집값 &lt;분석&gt;']),
      converters,
    );
    expect(a.kind).toBe('hwpx');
    const md = readFileSync(a.representations[0]!.path, 'utf8');
    expect(md).toBe('한글 기획서\n\n목표: 집값 <분석>\n');

    const withTable = createZip([
      { name: 'mimetype', data: 'application/hwp+zip', store: true },
      {
        name: 'Contents/section0.xml',
        data:
          '<hs:sec><hp:p><hp:run><hp:t>머리말</hp:t></hp:run></hp:p>' +
          '<hp:p><hp:run><hp:tbl><hp:tr><hp:tc><hp:subList><hp:p><hp:run><hp:t>항목</hp:t></hp:run></hp:p></hp:subList></hp:tc>' +
          '<hp:tc><hp:subList><hp:p><hp:run><hp:t>값</hp:t></hp:run></hp:p></hp:subList></hp:tc></hp:tr></hp:tbl></hp:run></hp:p></hs:sec>',
      },
      {
        name: 'Contents/section1.xml',
        data: '<hs:sec><hp:p><hp:run><hp:t>둘째 구역</hp:t></hp:run></hp:p></hs:sec>',
      },
    ]);
    expect(hwpxToMarkdown(withTable)).toBe('머리말\n\n| 항목 | 값 |\n| --- | --- |\n\n둘째 구역\n');
  });

  it('HWP + 도구 없음: 글 형태 없이 안내 + 도구 찾기 카드 요청', async () => {
    const found: unknown[] = [];
    const finder = { find: async (req: unknown) => found.push(req) };
    const a = await addAndConvert(project(), '옛문서.hwp', hwp(), converters, {
      tools: fakeTools(),
      onToolNeeded: toolFinderBridge(finder),
    });
    expect(a.kind).toBe('hwp');
    expect(a.status).toBe('ready');
    expect(a.representations).toEqual([]);
    expect(a.warnings).toEqual([
      { code: 'tool-needed', message: MESSAGES.hwpToolMissing, capability: 'HWP 문서에서 글 뽑기' },
    ]);
    expect(found).toEqual([
      { capability: 'HWP 문서에서 글 뽑기', why: 'HWP 첨부 파일 내용을 읽으려고 해요', source: 'user' },
    ]);
  });

  it('HWP + hwp5txt 있음: 그 결과를 글 형태로', async () => {
    const tools = fakeTools({ hwp5txt: () => ({ stdout: Buffer.from('옛 한글 문서 내용') }) });
    const a = await addAndConvert(project(), '옛문서.hwp', hwp(), converters, { tools });
    expect(tools.calls[0]!.args[0]).toBe(a.storedPath);
    expect(readFileSync(a.representations[0]!.path, 'utf8')).toBe('옛 한글 문서 내용');
  });
});
