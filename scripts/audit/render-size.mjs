// C3.17 size.md: 종류별 크기·줄일 수 있는 양 추정·사용자 데이터는 별도 표시
import { join } from 'node:path';
import { auditDir, mb, rawDir, readJson, writeFileSync } from './lib.mjs';
const r = (n) => readJson(join(rawDir, `${n}.json`), {});
const base = readJson(join(auditDir, 'baseline.json'), {});
const src = r('size-src'),
  deps = r('size-deps'),
  dist = r('size-dist'),
  fx = r('size-fixtures'),
  logs = r('size-logs'),
  user = r('size-userdata'),
  git = r('size-git'),
  bundle = r('bundle-top'),
  dup = r('dup-versions'),
  heavy = r('heavy-deps'),
  hist = r('git-history-large');
const wt = base.size?.worktrees ?? {};
const rows = [
  [
    '작업자 복사본(.claude/worktrees, 저장소 밖 취급)',
    `${mb(wt.estimateBytes ?? 0)} (어림, ${wt.count ?? 0}개 × 표본 ${mb(wt.sampleBytes ?? 0)}MB)`,
    `거의 전부(${mb(wt.estimateBytes ?? 0)}MB) — 끝난 작업자 복사본이면 지워도 됨, 단 자동 삭제 대상 아님(보류·사람 결정)`,
  ],
  [
    '의존성 node_modules',
    `${deps.nodeModulesMB} (${deps.dirCount}곳)`,
    `작음 — 같은 큰 버전 중복 정리(pnpm dedupe) 정도. 여러 버전 ${dup.duplicated}종은 대부분 큰 버전이 달라 못 합침`,
  ],
  [
    'pnpm 저장소(저장소 밖)',
    `${deps.pnpmStoreMB ?? '—'}`,
    '`pnpm store prune`으로 안 쓰는 판 정리 가능(점검 범위 밖, 제안만)',
  ],
  ['빌드 결과 dist(추적 안 함)', `${dist.totalMB}`, '0 — 다시 빌드하면 생김(Git 추적 안 함)'],
  [
    '웹 번들(apps/web/dist)',
    `${mb(base.bundle?.bytes ?? 0)} / gzip ${mb(base.bundle?.gzip ?? 0)}`,
    `코드 편집기(monaco) 언어 작업자: ts ${mb(bundle.top10?.[0]?.bytes ?? 0)}MB·css·html·json — 쓰는 언어만 남기면 수 MB 줄 수 있음(동작 영향 확인 필요)`,
  ],
  ['소스 코드(src)', `${src.totalMB}`, '통합(C-5) 결과에 따라 조금'],
  ['테스트 데이터·녹화', `${fx.totalMB} (${fx.files}개)`, '0 — 작음'],
  [
    '.git',
    `${mb(git.gitDirBytes ?? 0)} (느슨한 객체 ${git.countObjects?.count}개)`,
    '`git gc`로 느슨한 객체 묶기(기록은 그대로) — 수 MB',
  ],
];
let md = `# 용량 보고 (C-3)\n\n원본: docs/audit/raw/size-*.json, git-*.json, bundle-top.json, heavy-deps.json, dup-versions.json\n\n| 종류 | 지금 크기(MB) | 줄일 수 있는 양(추정) |\n| --- | --- | --- |\n${rows.map((x) => `| ${x.join(' | ')} |`).join('\n')}\n\n`;
md += `## 사용자 데이터 — 보고만, 삭제 대상 아님\n\n| 항목 | 크기 |\n| --- | --- |\n| 하네스 홈(${user.home}) 합계 | ${user.totalMB}MB |\n${Object.entries(
  user.parts ?? {},
)
  .map(([k, v]) => `| ${k} | ${mb(v)}MB |`)
  .join(
    '\n',
  )}\n| 하네스 로그·이벤트 | ${logs.totalMB}MB (${logs.files?.length ?? 0}개) |\n| 로컬 모델 | 없음(ollama 미설치) |\n\n`;
md += `## 설치 크기가 큰 의존성 상위 8\n\n| 패키지 | MB |\n| --- | --- |\n${(heavy.slice?.(0, 8) ?? []).map((h) => `| ${h.entry} | ${mb(h.bytes)} |`).join('\n')}\n\n`;
md += `## Git 기록 속 큰 객체 (보고만, 기록 다시 쓰기 안 함)\n\n${(hist.top20 ?? [])
  .slice(0, 5)
  .map((h) => `- ${h.path} ${mb(h.bytes)}MB`)
  .join('\n')}\n\n점검 결과 파일(raw/test-run-*.json, 각 약 2MB)이 가장 큽니다 — 점검 기록이라 남깁니다.\n`;
writeFileSync(join(auditDir, 'size.md'), md);
console.log('size.md written');
