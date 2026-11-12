// C6.9 설정 설명 문구와 실제 동작 차이(C2.7 연결) → raw/settings-doc-drift.json
// 설명은 "무엇을 바꾼다"고 말하는데 코드에서 읽는 곳이 0인 키 = 문서 차이
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { rawDir, readJson, root, writeJson } from './lib.mjs';
const k = await import(pathToFileURL(join(root, 'packages', 'kernel', 'dist', 'index.js')).href);
const readers = readJson(join(rawDir, 'settings-noeffect.json'), []);
const defs = new Map(k.settingsRegistry.list().map((d) => [d.key, d]));
const out = readers
  .filter((r) => r.noEffect)
  .map((r) => ({
    key: r.key,
    title: defs.get(r.key)?.title,
    description: defs.get(r.key)?.description,
    restartRequired: !!defs.get(r.key)?.restartRequired,
    runtimeReaders: r.runtimeReaders,
    drift: '설명은 동작을 바꾼다고 하지만 읽어서 쓰는 코드가 없음',
  }));
writeJson(join(rawDir, 'settings-doc-drift.json'), out);
console.log(`settings-doc-drift: ${out.length}개`);
for (const o of out) console.log(`  ${o.key}: ${o.title} — ${o.description}`);
