import { validate } from './findings-schema.mjs';
const ok = {
  id: 'C1-001',
  area: 'bug',
  severity: 'high',
  title: '예시 발견',
  evidence: ['a.ts:1'],
  features: ['F-001'],
  proposal: '고친다',
  risk: 'low',
  effort: 'S',
  status: 'open',
};
const cases = [
  ['정상', { findings: [ok] }, true],
  ['심각도 틀림', { findings: [{ ...ok, severity: 'huge' }] }, false],
  ['id 형식 틀림', { findings: [{ ...ok, id: 'X-1' }] }, false],
  ['근거 없음', { findings: [{ ...ok, evidence: [] }] }, false],
  ['모르는 칸', { findings: [{ ...ok, foo: 1 }] }, false],
  ['id 중복', { findings: [ok, ok] }, false],
  ['보류 상태', { findings: [{ ...ok, status: '보류: 위험 큼' }] }, true],
];
let fail = 0;
for (const [name, doc, want] of cases) {
  const r = validate(doc);
  const pass = r.ok === want;
  if (!pass) fail++;
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name} → ok=${r.ok}`);
}
process.exit(fail ? 1 : 0);
