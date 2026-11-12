// C1.3 엄격 타입 검사 오류(raw/tsc-strict.txt)를 규칙별로 묶어 발견 등록
import { join } from 'node:path';
import { rawDir, readFileSync } from './lib.mjs';
import { addFinding } from './add-finding.mjs';
import { featuresOf } from './feat-of.mjs';
const lines = readFileSync(join(rawDir, 'tsc-strict.txt'), 'utf8')
  .split('\n')
  .filter((l) => /error TS\d+/.test(l));
const parse = (l) => {
  const m = l.match(/^(.+?)\((\d+),\d+\): error (TS\d+): (.*)$/);
  return m && { file: m[1], line: m[2], code: m[3], msg: m[4] };
};
const errs = lines.map(parse).filter(Boolean);
const groups = [
  {
    codes: ['TS2379', 'TS2375', 'TS2412'],
    title: '선택 칸(옵션)에 undefined를 그대로 넣는 곳 — exactOptionalPropertyTypes 엄격 검사 위반',
    severity: 'low',
    risk: 'medium',
    effort: 'M',
    proposal:
      '값이 있을 때만 칸을 넣도록(...(x ? {k:x} : {})) 고치거나, 타입에 | undefined를 명시. 파일이 많아 한 번에 고치면 위험 → 패키지별로 나눠서',
  },
  {
    codes: ['TS4114'],
    title: '부모 메서드를 덮어쓰는데 override 표시가 없음 — noImplicitOverride 위반',
    severity: 'low',
    risk: 'low',
    effort: 'S',
    proposal: '덮어쓰는 메서드 앞에 override 키워드 추가(동작 변화 없음)',
  },
  {
    codes: ['TS2322', 'TS2345', 'TS2698', 'TS2339', 'TS2769'],
    title:
      '엄격 설정에서만 드러나는 타입 불일치(합집합 타입 칸 접근·unknown 펼치기·LogRecord↔QuotaEventLike 등)',
    severity: 'low',
    risk: 'medium',
    effort: 'M',
    proposal: '타입 좁히기(가드)·명시적 타입 지정으로 정리. 실행 동작에는 영향 없음을 확인하며 1곳씩',
  },
];
const ids = [];
for (const g of groups) {
  const es = errs.filter((e) => g.codes.includes(e.code));
  if (!es.length) continue;
  const files = [...new Set(es.map((e) => e.file))];
  ids.push(
    addFinding(1, {
      area: 'bug',
      severity: g.severity,
      title: `${g.title} (${es.length}건, 파일 ${files.length}개)`,
      evidence: [
        'docs/audit/raw/tsc-strict.txt',
        ...es.slice(0, 12).map((e) => `${e.file}:${e.line} ${e.code}`),
      ],
      features: featuresOf(files),
      proposal: g.proposal,
      risk: g.risk,
      effort: g.effort,
      meta: { source: 'C1.3', codes: g.codes, count: es.length, files },
    }),
  );
}
console.log(`C1.3 등록 ${ids.length}건: ${ids.join(' ')} (오류 합계 ${errs.length})`);
