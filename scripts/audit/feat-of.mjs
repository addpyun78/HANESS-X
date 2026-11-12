// 파일 경로 → 그 파일을 코드로 가진 기능 id 목록 (feature-map.json 기준)
import { join } from 'node:path';
import { auditDir, readJson } from './lib.mjs';
let map;
export function featuresOf(files) {
  map ??= readJson(join(auditDir, 'feature-map.json'));
  const want = new Set(files.map((f) => f.replace(/:\d+.*$/, '')));
  return map.features.filter((f) => f.code.some((c) => want.has(c.at.split(':')[0]))).map((f) => f.id);
}
