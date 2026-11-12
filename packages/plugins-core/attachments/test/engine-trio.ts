import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Attachment, EngineAdapter, EngineRunOptions } from '@harness-x/protocol';
import { AttachmentStore, ConversionQueue, DEFAULT_CONVERTERS } from '../src/index.js';
import { jpeg, textPdf, xlsx } from './samples.js';

/** 엔진 리플레이 공용: 그림·PDF·XLSX 3종 첨부와 가짜 CLI */

export const FAKE_CLI = fileURLToPath(new URL('./fixtures/fake-cli.mjs', import.meta.url));

export async function attachmentTrio(): Promise<{ root: string; list: Attachment[]; cleanup: () => void }> {
  const root = mkdtempSync(join(tmpdir(), 'hx-trio-'));
  const store = new AttachmentStore({ projectRoot: root });
  const q = new ConversionQueue({ store, converters: DEFAULT_CONVERTERS });
  const added = await store.addMany('s', [
    { name: '화면.jpg', data: jpeg({ width: 1280, height: 720 }) },
    { name: '보고서.pdf', data: textPdf() },
    {
      name: '매물.xlsx',
      data: xlsx({
        매물: [
          ['동네', '가격'],
          ['마포', 12],
        ],
        시세: [['월'], ['1월']],
        메모: [['비고']],
      }),
    },
  ]);
  const list: Attachment[] = [];
  for (const r of added) list.push(await q.enqueue(r.attachment));
  return { root, list, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

/** 가짜 CLI로 엔진을 한 번 돌리고 받은 인자를 돌려준다 */
export async function replayArgv(
  engine: Pick<EngineAdapter, 'run'>,
  opts: Omit<EngineRunOptions, 'env'>,
  outFile: string,
): Promise<string[]> {
  const run = engine.run({ ...opts, env: { ...process.env, HX_ARGV_OUT: outFile } });
  for await (const _e of run.events) {
    /* 다 읽기 */
  }
  await run.done;
  const lines = readFileSync(outFile, 'utf8').trim().split('\n');
  return JSON.parse(lines.at(-1)!) as string[];
}
