// C6.2 후보마다 최신 버전 공개일(npm view <패키지> time --json) → 14일 미만 제외 표시 → raw/outdated-dated.json
// C6.3 분류: 보안 수정(pnpm audit와 겹침) / 큰 버전 / 작은 버전 → raw/outdated-class.json
// 큰 버전 업데이트도 같은 큰 버전 안의 최신(wanted)이 있으면 '작은 버전' 후보로 따로 적는다
import { join } from 'node:path';
import { rawDir, readJson, run, writeJson } from './lib.mjs';
const mode = process.argv[2];
const now = Date.now();
const major = (v) =>
  Number(
    String(v)
      .replace(/^[^\d]*/, '')
      .split('.')[0],
  );
if (mode === 'dated') {
  const out = readJson(join(rawDir, 'outdated.json'), {});
  const list = [];
  for (const [key, v] of Object.entries(out)) {
    const name = key.replace(/@[\d.]+$/, '').replace(/ \(dev\)$/, '');
    const r = run('npm', ['view', name, 'time', '--json'], { timeout: 60_000 });
    let time = {};
    try {
      time = JSON.parse(r.stdout || '{}');
    } catch {
      /* 조회 실패 */
    }
    // 같은 큰 버전 안 최신(작은 버전 업데이트 후보)
    const sameMajor = Object.keys(time)
      .filter((x) => /^\d+\.\d+\.\d+$/.test(x) && major(x) === major(v.current))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .at(-1);
    const days = (ver) => (time[ver] ? Math.floor((now - Date.parse(time[ver])) / 86400000) : null);
    list.push({
      package: name,
      key,
      current: v.current,
      latest: v.latest,
      latestPublished: time[v.latest] ?? null,
      latestAgeDays: days(v.latest),
      latestTooNew: (days(v.latest) ?? 0) < 14,
      sameMajorLatest: sameMajor ?? null,
      sameMajorAgeDays: sameMajor ? days(sameMajor) : null,
      dependents: (v.dependentPackages ?? []).map((d) => d.name),
    });
  }
  writeJson(join(rawDir, 'outdated-dated.json'), list);
  console.log(`dated: ${list.length}개, 최신이 14일 미만 ${list.filter((x) => x.latestTooNew).length}개`);
} else if (mode === 'class') {
  const list = readJson(join(rawDir, 'outdated-dated.json'), []);
  const audit = readJson(join(rawDir, 'pnpm-audit.json'), { advisories: {} });
  const vulnerable = new Set(Object.values(audit.advisories ?? {}).map((a) => a.module_name));
  const out = list.map((x) => {
    const isMajor = major(x.latest) > major(x.current);
    const minorAvail = x.sameMajorLatest && x.sameMajorLatest !== x.current;
    return {
      ...x,
      security: vulnerable.has(x.package),
      class: vulnerable.has(x.package) ? '보안 수정' : isMajor ? '큰 버전' : '작은 버전',
      minorCandidate: minorAvail
        ? { to: x.sameMajorLatest, ageDays: x.sameMajorAgeDays, ok14: (x.sameMajorAgeDays ?? 0) >= 14 }
        : null,
    };
  });
  // pnpm audit에만 있는 보안 수정(직접 의존성이 아닌 것)
  for (const a of Object.values(audit.advisories ?? {}))
    if (!out.some((o) => o.package === a.module_name))
      out.push({
        package: a.module_name,
        current: a.findings?.[0]?.version,
        latest: a.patched_versions,
        class: '보안 수정',
        security: true,
        transitive: true,
        path: a.findings?.[0]?.paths?.[0],
      });
  const uniq = [...new Map(out.map((o) => [o.package + (o.transitive ? '#t' : ''), o])).values()];
  writeJson(join(rawDir, 'outdated-class.json'), uniq);
  const c = {};
  for (const o of uniq) c[o.class] = (c[o.class] ?? 0) + 1;
  console.log(
    `class: ${JSON.stringify(c)}, 같은 큰 버전 안 업데이트 가능 ${uniq.filter((o) => o.minorCandidate?.ok14).length}개`,
  );
}
