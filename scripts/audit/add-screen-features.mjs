// B.4 사용자 화면 기준 기능 누락 보완
// 화면 동작 레지스트리(snapshots/actions.json)를 화면(id 앞부분)별로 묶어, 티켓 기반 기능 어디에도 연결되지 않은
// 동작이 있는 화면마다 "화면: <화면>" 기능을 보탠다(extra: true, keywords = 그 동작 id들).
// 사이드바·입력창·패널·설정·설치 관리·빌더 화면이 모두 여기서 확인된다.
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { auditDir, readJson, root, writeJson } from './lib.mjs';

const mapFile = join(auditDir, 'feature-map.json');
// 티켓 기반 기능만 남기고 동작 연결을 다시 계산
const m0 = readJson(mapFile);
m0.features = m0.features.filter((f) => !f.extra);
writeJson(mapFile, m0);
execFileSync(process.execPath, [join(root, 'scripts/audit/link-features.mjs'), 'actions'], {
  stdio: 'ignore',
});
const map = readJson(mapFile);
const linked = new Set(map.features.flatMap((f) => f.entries.actions));
const actions = readJson(join(auditDir, 'snapshots', 'actions.json')).map((a) => a.id);
const SCREEN_NAME = {
  shell: '화면 틀(사이드바·패널 열기)',
  sidebar: '사이드바',
  nav: '화면 이동 메뉴',
  composer: '입력창',
  panel: '오른쪽 패널',
  settings: '설정 화면',
  install: '설치 관리 화면',
  builder: '에이전트 만들기 화면',
  chat: '대화 화면',
  engines: '엔진 화면',
};
const byScreen = new Map();
for (const id of actions) {
  if (linked.has(id)) continue;
  const s = id.split('.')[0];
  if (!byScreen.has(s)) byScreen.set(s, []);
  byScreen.get(s).push(id);
}
let n = map.features.length;
const added = [];
for (const [s, ids] of [...byScreen.entries()].sort()) {
  const f = {
    id: `F-${String(++n).padStart(3, '0')}`,
    name: `화면: ${SCREEN_NAME[s] ?? s}`,
    sources: [{ ticket: 'screen', section: `apps/web/src/actions/registry.ts (${s}.*)` }],
    doneItems: 0,
    extra: true,
    keywords: ids,
    entries: { actions: [], api: [], cli: [], mcp: [], hooks: [], settings: [] },
    code: [],
    tests: [],
    status: '정상',
  };
  map.features.push(f);
  added.push(`${f.id} ${f.name} (${ids.length})`);
}
map.screenAdded = added;
writeJson(mapFile, map);
console.log(JSON.stringify({ added: added.length, unlinkedActions: actions.length - linked.size }));
console.log(added.join('\n'));
