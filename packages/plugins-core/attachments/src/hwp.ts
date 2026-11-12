import type { Converter } from './context.js';
import { warn, writeRep } from './context.js';
import { MESSAGES } from './messages.js';
import { markdownTable, zipText } from './office.js';
import { TOOL_NEEDS } from './tools.js';
import { blocks, textOf } from './xml.js';
import { listZip } from './zip.js';

/**
 * 1B.5 한글 문서.
 * HWPX: 압축 안 Contents/section*.xml에서 글 직접 추출.
 * HWP(옛 바이너리): hwp5txt가 PATH에 있으면 사용, 없으면 T-100 도구 찾기 카드.
 */

function hwpxParagraph(p: string): string {
  return textOf(
    p.replace(/<hp:tab\b[^>]*\/>/g, '<hp:t>\t</hp:t>').replace(/<hp:lineBreak\/>/g, '<hp:t>\n</hp:t>'),
    'hp:t',
  );
}

export function hwpxToMarkdown(buf: Buffer): string {
  const entries = listZip(buf);
  const sections = entries
    .map((e) => ({ name: e.name, n: Number(/^Contents\/section(\d+)\.xml$/.exec(e.name)?.[1] ?? NaN) }))
    .filter((x) => !Number.isNaN(x.n))
    .sort((a, b) => a.n - b.n);
  const out: string[] = [];
  for (const s of sections) {
    const xml = zipText(buf, entries, s.name) ?? '';
    // 최상위 문단마다: 표가 들어 있으면 Markdown 표, 아니면 글
    for (const p of blocks(xml, 'hp:p')) {
      const tables = blocks(p, 'hp:tbl');
      const t = tables.length
        ? tables
            .map((tbl) =>
              markdownTable(
                blocks(tbl, 'hp:tr').map((tr) =>
                  blocks(tr, 'hp:tc').map((tc) => blocks(tc, 'hp:p').map(hwpxParagraph).join(' ')),
                ),
              ),
            )
            .join('\n\n')
        : hwpxParagraph(p);
      if (t.trim()) out.push(t);
    }
  }
  return out.join('\n\n') + '\n';
}

export const convertHwpx: Converter = async (_a, data, ctx) => ({
  representations: [writeRep(ctx, 'text', 'text.md', hwpxToMarkdown(data), 'text/markdown')],
  warnings: [],
});

export const convertHwp: Converter = async (a, _data, ctx) => {
  const bin = ctx.tools.which('hwp5txt');
  if (!bin) {
    ctx.onToolNeeded?.({ ...TOOL_NEEDS.hwp5txt });
    return {
      representations: [],
      warnings: [warn('tool-needed', MESSAGES.hwpToolMissing, TOOL_NEEDS.hwp5txt.capability)],
    };
  }
  const r = await ctx.tools.run(bin, [a.storedPath]);
  if (r.code !== 0) throw new Error('hwp5txt 실패');
  return {
    representations: [
      writeRep(ctx, 'text', 'text.txt', r.stdout.toString('utf8'), 'text/plain; charset=utf-8'),
    ],
    warnings: [],
  };
};
