// C2.7 설정 키마다 코드에서 읽는 곳 개수(등록 파일·테스트 제외). 0곳이면 "바꿔도 효과 없음" 의심 → raw/settings-noeffect.json
// 읽는 곳 = 키 문자열('a.b.c') 또는 경로 배열 접근(settings.a.b / ['a','b'])이 나오는 소스 줄
import { join } from 'node:path';
import { auditDir, listFiles, rawDir, readFileSync, readJson, rel, root, writeJson } from './lib.mjs';
const keys = readJson(join(auditDir, 'snapshots', 'settings-keys.json'));
const files = listFiles(
  root,
  (p) => /\.(ts|tsx)$/.test(p) && /[\\/]src[\\/]/.test(p) && !/\.test\.tsx?$/.test(p) && !p.endsWith('.d.ts'),
  {
    skipDirs: ['node_modules', 'dist', '.git', '.claude', 'target', '.harness-x-dev', 'docs'],
  },
).filter((f) => !/settings[\\/]registry\.ts$/.test(f));
const texts = files.map((f) => [rel(f), readFileSync(f, 'utf8')]);
const out = [];
for (const k of keys) {
  const parts = k.key.split('.');
  const dotted = parts.join('?.').replace(/\?\./g, '\\??\\.');
  const res = [new RegExp(`['"\`]${k.key.replace(/\./g, '\\.')}['"\`]`), new RegExp(`\\b${dotted}\\b`)];
  // 브라우저 저장 키·키체인 계정 이름으로 읽는 곳
  if (k.browserKey)
    res.push(new RegExp(`['"\`]${k.browserKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"\`]`));
  if (k.secretAccount)
    res.push(new RegExp(`['"\`]${k.secretAccount.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"\`]`));
  if (parts.length > 1) res.push(new RegExp(`\\[\\s*'${parts.join("'\\s*,\\s*'")}'\\s*\\]`));
  const readers = [];
  for (const [f, t] of texts) {
    const lines = t.split('\n');
    lines.forEach((l, i) => {
      if (res.some((r) => r.test(l))) readers.push(`${f}:${i + 1}`);
    });
  }
  // 설정 화면(apps/web)만 쓰는 곳은 "읽어서 동작에 쓰는 곳"이 아니다
  const runtime = readers.filter((r) => !r.startsWith('apps/web/src/settings/'));
  out.push({
    key: k.key,
    group: k.group,
    storage: k.storage,
    readers: readers.length,
    runtimeReaders: runtime.length,
    where: readers.slice(0, 8),
    noEffect: runtime.length === 0,
  });
}
writeJson(join(rawDir, 'settings-noeffect.json'), out);
console.log(
  `settings: ${out.length}개 중 읽는 곳 0 (효과 없음 의심) ${out.filter((o) => o.noEffect).length}개`,
);
console.log(
  out
    .filter((o) => o.noEffect)
    .map((o) => `${o.key} [${o.storage}] readers=${o.readers}`)
    .join('\n'),
);
