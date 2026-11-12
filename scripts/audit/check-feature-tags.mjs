// B.25 태그 없는 기능 0개인지 검사 (feature-map.json의 모든 기능이 태그 붙은 테스트 파일 1개 이상을 가져야 함)
import { join } from 'node:path';
import { auditDir, readJson } from './lib.mjs';
import { taggedFiles } from './feature-tags.mjs';
const map = readJson(join(auditDir, 'feature-map.json'));
const covered = new Set([...taggedFiles().values()].flat());
const missing = map.features
  .filter((f) => f.status !== '준비 중' && !covered.has(f.id))
  .map((f) => `${f.id} ${f.name}`);
console.log(`check-feature-tags: 기능 ${map.features.length}개 중 태그 없음 ${missing.length}개`);
if (missing.length) {
  console.log(missing.join('\n'));
  process.exit(1);
}
