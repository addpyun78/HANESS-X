// D 단계 보고서·자동 승인 도구
// usage: node scripts/audit/report.mjs <validate|merge|severity|plain|render|plaincheck|auto|approve>
//  validate  (D.1)  findings.json 스키마 검사
//  merge     (D.2)  같은 원인 발견 병합(근거 합침) — 병합 목록은 아래 MERGES
//  severity  (D.3)  심각도 기준 적용(치명=데이터 손실·보안·핵심 기능 불가 / 높음=기능 오작동 / 보통=불편·성능 / 낮음=코드 품질)
//  plain     (D.4)  발견마다 쉬운 말 한 줄(docs/audit/plain-lines.json) 넣고 쉬운 말 검사기 통과 확인
//  render    (D.5~D.11) report.md 만들기(요약 5줄·무인 모드 안내·분류별 표·묶음·용량·통합·업데이트)
//  plaincheck(D.12) report.md의 사람이 읽는 문장 쉬운 말 검사
//  auto      (D.13) 자동 승인 규칙(docs/audit/auto-policy.md) 적용 → 결정·이유를 findings와 report.md 체크박스에 반영
//  approve   (D.14) report.md 체크 상태 → approved.json
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { auditDir, rawDir, readFileSync, readJson, root, writeFileSync, writeJson } from './lib.mjs';
import { validate } from './findings-schema.mjs';

const ffile = join(auditDir, 'findings.json');
const load = () => readJson(ffile, { findings: [] });
const save = (d) => writeJson(ffile, d);
const { checkPlainKorean } = await import(pathToFileURL(join(root, 'packages', 'plugins-core', 'approvals', 'dist', 'plain-korean.js')).href);
const mode = process.argv[2];

// D.2 같은 원인: [남길 id, 합칠 id들]
const MERGES = [
  ['C2-004', ['C6-006']], // 효과 없는 설정 4개 = 설정 설명 차이
];

const AREA_LABEL = { bug: '버그', shell: '껍데기', security: '보안', size: '용량', unused: '안 쓰는 코드', consolidation: '통합', update: '업데이트', docs: '문서', structure: '폴더 구조' };
const SEV_LABEL = { critical: '치명', high: '높음', medium: '보통', low: '낮음' };
const RISK_LABEL = { low: '낮음', medium: '보통', high: '높음' };

if (mode === 'validate') {
  const r = validate(load());
  console.log(`validate: ${r.ok ? '오류 0' : r.errors.join('; ')}`);
  process.exit(r.ok ? 0 : 1);
}

if (mode === 'merge') {
  const d = load();
  const before = d.findings.filter((f) => !f.status.startsWith('merged-into')).length;
  for (const [keep, others] of MERGES) {
    const k = d.findings.find((f) => f.id === keep);
    for (const o of others) {
      const x = d.findings.find((f) => f.id === o);
      if (!k || !x || x.status.startsWith('merged-into')) continue;
      k.evidence = [...new Set([...k.evidence, ...x.evidence])];
      k.features = [...new Set([...k.features, ...x.features])];
      x.status = `merged-into: ${keep}`;
    }
  }
  save(d);
  const after = d.findings.filter((f) => !f.status.startsWith('merged-into')).length;
  console.log(`merge: 병합 전 ${before}개 → 병합 후 ${after}개`);
}

if (mode === 'severity') {
  // 기준을 다시 적용: 보안 취약점 중 사용자 화면에 닿는 것 = 치명, 개발 도구만 = 높음 / 화면·명령이 안 되는 것 = 높음 / 불편·성능·용량 = 보통 이하 / 코드 품질 = 낮음
  const d = load();
  const changed = [];
  for (const f of d.findings) {
    let s = f.severity;
    if (f.area === 'security') s = f.meta?.prod ? 'critical' : 'high';
    else if (f.area === 'shell' && s !== 'critical' && /404|등록되지 않|등록하지 않|항상 실패/.test(f.title)) s = 'high';
    else if (['size', 'update', 'docs', 'structure', 'consolidation'].includes(f.area) && s === 'high') s = 'medium';
    if (s !== f.severity) {
      changed.push(`${f.id} ${f.severity}→${s}`);
      f.severity = s;
    }
  }
  save(d);
  const missing = d.findings.filter((f) => !f.severity).length;
  console.log(`severity: 바뀐 것 ${changed.length}개 ${changed.join(', ')} · 심각도 없는 발견 ${missing}개`);
}

if (mode === 'plain') {
  const d = load();
  const lines = readJson(join(auditDir, 'plain-lines.json'), {});
  const bad = [];
  let n = 0;
  for (const f of d.findings) {
    if (f.status.startsWith('merged-into')) continue;
    const t = lines[f.id];
    if (!t) {
      bad.push(`${f.id}: 쉬운 말 줄 없음`);
      continue;
    }
    const r = checkPlainKorean(t);
    if (!r.ok) bad.push(`${f.id}: ${r.violations.map((v) => v.detail).join(' / ')}`);
    f.plain = t;
    n++;
  }
  save(d);
  console.log(`plain: ${n}개 넣음, 검사 실패 ${bad.length}개`);
  if (bad.length) {
    console.log(bad.join('\n'));
    process.exit(1);
  }
}

// ── 자동 승인 규칙 (auto-policy.md) ─────────────────────────
function decide(f) {
  const m = f.meta ?? {};
  if (f.status.startsWith('merged-into')) return null;
  // 사용자가 대화에서 직접 고치라고 한 발견은 표보다 우선(무인 모드 규칙: 사람의 명시 지시가 자동 결정보다 앞섬)
  if (m.userApproved) return ['fix', '사용자가 꼭 고치라고 해서 진행해요.'];
  if (m.noAction) return ['hold', '조치가 필요 없는 확인 결과라 기록만 해요.'];
  if (m.userAction) return ['hold', '사용자가 직접 해야 하는 일이라 기록만 해요.'];
  if (m.next) return ['hold', '다음 작업 제안으로 넘겨요.'];
  switch (f.area) {
    case 'bug':
      if (f.severity === 'critical' || f.severity === 'high')
        return f.risk === 'high' ? ['hold', '고칠 때 위험이 커서 보류해요.'] : ['fix', '심각하고 고칠 위험이 크지 않아 진행해요.'];
      return f.risk === 'low' ? ['fix', '고칠 위험이 낮아 진행해요.'] : ['hold', '고칠 위험이 낮지 않아 보류해요.'];
    case 'security':
      return m.major ? ['hold', '큰 판 올림이 필요해 보류해요.'] : ['fix', '같은 큰 판 안에서 고칠 수 있어 진행해요.'];
    case 'shell':
      if (f.effort === 'S' && m.criteria) return ['implement', '작고 원래 할 일이 분명해 구현해요.'];
      if (f.severity === 'high' && f.risk !== 'high' && m.wiring)
        return ['fix', '만들어 둔 기능을 연결만 하면 되는 버그라 고쳐요.'];
      if (/단언/.test(f.title)) return f.risk === 'low' ? ['fix', '고칠 위험이 낮아 진행해요.'] : ['hold', '보류해요.'];
      return ['hide', '바로 만들기 어려워 숨기고 준비 중이라고 알려요.'];
    case 'update':
      if (m.security && !m.major && !m.tooNew) return ['fix', '보안 수정이고 작은 판이라 진행해요.'];
      return ['hold', m.major ? '큰 판 올림이라 보류해요.' : m.tooNew ? '나온 지 14일이 안 돼 보류해요.' : '보안 수정이 아니라 보류해요.'];
    case 'docs':
      return ['fix', '문서 차이는 모두 고쳐요.'];
    case 'consolidation':
      return m.behaviorDiff === 0 && f.risk === 'low' ? ['fix', '동작 차이가 없고 위험이 낮아 합쳐요.'] : ['hold', '동작 차이가 있거나 위험이 있어 보류해요.'];
    case 'structure':
      return ['hold', '폴더 옮기기는 제안만 해요.'];
    case 'size':
      if (m.dedupe) return ['fix', '같은 큰 판끼리 정리라 위험이 낮아요.'];
      return ['hold', '지우기 표에 없는 종류라 보류해요.'];
    case 'unused':
      return m.fourEvidence && ['dependency', 'export', 'file', 'generated'].includes(m.kind) ? ['fix', '네 가지 근거가 모두 맞아 지워요.'] : ['hold', '근거가 모자라 보류해요.'];
    default:
      return ['hold', '애매해서 보류해요.'];
  }
}

if (mode === 'auto') {
  const d = load();
  let n = 0;
  for (const f of d.findings) {
    const r = decide(f);
    if (!r) continue;
    f.decision = r[0];
    f.decisionReason = r[1];
    f.bundle = f.decision === 'hold' ? 'hold' : ['critical', 'high'].includes(f.severity) ? 'must' : 'nice';
    n++;
  }
  save(d);
  render();
  const c = {};
  for (const f of d.findings) if (f.decision) c[f.decision] = (c[f.decision] ?? 0) + 1;
  console.log(`auto: 결정 ${n}개 ${JSON.stringify(c)} · 결정 없는 발견 ${d.findings.filter((f) => !f.status.startsWith('merged-into') && !f.decision).length}개`);
}

if (mode === 'approve') {
  const md = readFileSync(join(auditDir, 'report.md'), 'utf8');
  const out = [];
  for (const m of md.matchAll(/^- \[x\] 승인 `(C\d-\d{3})`(?: \((fix|implement|hide)\))?/gm)) out.push({ id: m[1], choice: m[2] ?? 'fix' });
  const checks = (md.match(/^- \[x\] 승인 `C\d-\d{3}`/gm) ?? []).length;
  writeJson(join(auditDir, 'approved.json'), { generatedAt: new Date().toISOString(), source: 'docs/audit/report.md', approved: out });
  console.log(`approve: 체크 ${checks}개 = approved ${out.length}개`);
}

// ── report.md ─────────────────────────────────────────────
function render() {
  const d = load();
  const live = d.findings.filter((f) => !f.status.startsWith('merged-into'));
  const base = readJson(join(auditDir, 'baseline.json'), {});
  const summary = readJson(join(auditDir, 'report-summary.json'), { lines: [] }).lines;
  const BUNDLE = { must: '⭐꼭 고칠 것', nice: '하면 좋은 것', hold: '⚠보류 추천' };
  const box = (f) => {
    const on = f.decision && f.decision !== 'hold';
    return `- [${on ? 'x' : ' '}] 승인 \`${f.id}\`${on ? ` (${f.decision})` : ''} — ${f.plain ?? f.title}  \n  ${BUNDLE[f.bundle] ?? '—'} · 심각도 ${SEV_LABEL[f.severity]} · 위험 ${RISK_LABEL[f.risk]} · 작업량 ${f.effort} · 결정: ${f.decisionReason ?? '아직 없음'}`;
  };
  let md = `# T-102 점검 보고서\n\n`;
  md += `## 한눈에 보기\n\n${summary.map((l) => `- ${l}`).join('\n')}\n\n`;
  md += `## 무인 모드 안내\n\n이 보고서는 무인 모드로 자동 결정됐어요.\n규칙은 \`docs/audit/auto-policy.md\`에 있어요.\n결정을 바꾸려면 보류 항목의 [ ]를 [x]로 바꿔 주세요.\n그다음 러너를 다시 실행하면 돼요.\n러너 명령은 \`node scripts/audit/run-audit.mjs\`예요.\n\n`;
  const order = ['bug', 'shell', 'security', 'size', 'unused', 'consolidation', 'update', 'docs', 'structure'];
  for (const a of order) {
    const fs = live.filter((f) => f.area === a);
    md += `## ${AREA_LABEL[a]} (${fs.length}건)\n\n`;
    if (!fs.length) {
      md += `발견이 없어요.\n\n`;
      continue;
    }
    md += `| id | 쉬운 말 설명 | 심각도 | 위험 | 작업량 | 묶음 | 결정 |\n| --- | --- | --- | --- | --- | --- | --- |\n`;
    for (const f of fs) md += `| ${f.id} | ${f.plain ?? f.title} | ${SEV_LABEL[f.severity]} | ${RISK_LABEL[f.risk]} | ${f.effort} | ${BUNDLE[f.bundle] ?? '—'} | ${f.decision ?? '—'} |\n`;
    md += `\n${fs.map(box).join('\n')}\n\n`;
  }
  // D.9 용량
  const sz = base.size?.mb ?? {};
  md += `## 용량 요약\n\n| 종류 | 지금 크기(MB) | 줄일 수 있는 양 |\n| --- | --- | --- |\n| 지난 작업자 복사본 | ${sz.worktreesEstimate ?? '—'} | 거의 전부(사람 결정) |\n| 프로그램 묶음(node_modules) | ${sz.nodeModules ?? '—'} | 조금(같은 판 정리) |\n| 원본 파일 | ${sz.source ?? '—'} | 거의 없음 |\n| 기록 폴더(.git) | ${sz.git ?? '—'} | 조금(묶기) |\n| 화면 묶음 파일 | ${base.bundle ? Math.round(base.bundle.bytes / 104857.6) / 10 : '—'} | 몇 MB(편집기 언어 줄이기) |\n\n자세한 내용은 \`docs/audit/size.md\`에 있어요.\n\n`;
  // D.10 통합
  md += `## 통합 요약\n\n| 영역 | 합치면 줄어드는 양 | 위험 | 판단 |\n| --- | --- | --- | --- |\n| 쉬운 말 판정 2벌 | 약 3줄 | 낮음 | 합쳐요 |\n| 경로 바꾸기 3벌 | 약 15줄 | 보통 | 동작이 달라 보류해요 |\n| 답에서 값 뽑기 3벌 | 약 20줄 | 보통 | 동작이 달라 보류해요 |\n| 시간 제한 3벌 | 약 20줄 | 보통 | 약속이 달라 보류해요 |\n| 비밀 가리기 3벌 | 약 15줄 | 높음 | 가리는 범위가 달라 보류해요 |\n\n자세한 내용은 \`docs/audit/consolidation.md\`에 있어요.\n\n`;
  // D.11 업데이트 (보안 먼저)
  const oc = readJson(join(rawDir, 'outdated-class.json'), []);
  const sec = oc.filter((o) => o.security);
  const rest = oc.filter((o) => !o.security);
  md += `## 업데이트 요약 (보안 수정 먼저)\n\n| 종류 | 이름 | 지금 | 새 판 | 결정 |\n| --- | --- | --- | --- | --- |\n`;
  for (const o of [...sec, ...rest]) md += `| ${o.class} | \`${o.package}\` | ${o.current ?? '—'} | ${o.latest ?? '—'} | ${o.package === 'dompurify' ? '진행(같은 큰 판, 공개 31일)' : o.class === '작은 버전' ? '보류(나온 지 14일 안 됨)' : '보류(큰 판)'} |\n`;
  md += `\n`;
  writeFileSync(join(auditDir, 'report.md'), md);
  return md;
}

if (mode === 'render') {
  const md = render();
  const tables = (md.match(/^\| id \| 쉬운 말 설명/gm) ?? []).length;
  console.log(`render: report.md 분류 표 ${tables}개, 전체 표 ${(md.match(/^\| --- /gm) ?? []).length}개`);
}

if (mode === 'plaincheck') {
  // 사람이 읽는 문장: 요약·안내·쉬운 말 설명 칸. 표의 id·이름·숫자 칸과 `코드`는 제외
  const md = readFileSync(join(auditDir, 'report.md'), 'utf8');
  const d = load();
  const texts = [];
  const sum = md.split('## 한눈에 보기')[1]?.split('## ')[0] ?? '';
  texts.push(...sum.split('\n').filter((l) => l.startsWith('- ')).map((l) => l.slice(2)));
  const notice = md.split('## 무인 모드 안내')[1]?.split('## ')[0] ?? '';
  texts.push(...notice.split('\n').filter(Boolean).map((l) => l.replace(/`[^`]*`/g, '"파일"')));
  for (const f of d.findings) if (f.plain && !f.status.startsWith('merged-into')) texts.push(f.plain);
  for (const f of d.findings) if (f.decisionReason) texts.push(f.decisionReason);
  const bad = [];
  for (const t of texts) {
    const r = checkPlainKorean(t);
    if (!r.ok) bad.push(`${t} → ${r.violations.map((v) => v.detail).join(' / ')}`);
  }
  console.log(`plaincheck: 문장 묶음 ${texts.length}개, 실패 ${bad.length}개`);
  if (bad.length) {
    console.log(bad.join('\n'));
    process.exit(1);
  }
}
