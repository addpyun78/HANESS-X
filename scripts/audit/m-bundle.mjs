// A.12 apps/web/dist 총 크기와 gzip 크기 → baseline.json.bundle
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
import { listFiles, mergeOut, readFileSync, root, rel } from './lib.mjs';
const files = listFiles(join(root, 'apps', 'web', 'dist'), () => true, { skipDirs: [] });
let bytes = 0;
let gzip = 0;
const items = [];
for (const f of files) {
  const buf = readFileSync(f);
  const g = gzipSync(buf).length;
  bytes += buf.length;
  gzip += g;
  items.push({ file: rel(f), bytes: buf.length, gzip: g });
}
items.sort((a, b) => b.bytes - a.bytes);
mergeOut('bundle', { bytes, gzip, files: files.length, top: items.slice(0, 10) });
console.log(JSON.stringify({ bytes, gzip, files: files.length }));
