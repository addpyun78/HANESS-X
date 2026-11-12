// C5.2~C5.10 같은 일을 하는 구현 찾기(정의 위치만, 쓰는 곳 제외)
// usage: node scripts/audit/same-work.mjs <영역|all>
import { join } from 'node:path';
import { rawDir, readFileSync, root, sh, writeJson } from './lib.mjs';
const files = sh('git ls-files packages apps')
  .split('\n')
  .filter((f) => /\/src\/.*\.(ts|tsx)$/.test(f) && !/\.test\.|\.d\.ts$/.test(f));
const DEF = (name) =>
  new RegExp(
    `(?:export\\s+)?(?:async\\s+)?(?:function\\s+(${name})\\s*[<(]|(?:const|let)\\s+(${name})\\s*(?::[^=]+)?=\\s*(?:async\\s*)?(?:\\([^)]*\\)|[a-zA-Z_]+)\\s*(?::[^=]+)?=>)`,
    'g',
  );
const AREAS = {
  'same-path': {
    title: '경로 정규화',
    def: DEF(
      '\\w*(?:[nN]ormali[sz]e\\w*Path|toPosix\\w*|posixPath|normPath|normalizeSlashes|toForwardSlash\\w*|unixPath)\\w*',
    ),
  },
  'same-spawn': {
    title: '자식 프로세스 실행·종료',
    def: DEF(
      '\\w*(?:spawn\\w*|run(?:Line)?Process|killTree|killProcessTree|terminate\\w*|execCapture|runCommand|runCli)\\w*',
    ),
    body: /\bspawn(Sync)?\(|\bexecFile(Sync)?\(/,
  },
  'same-json': {
    title: 'AI 응답에서 JSON 뽑기',
    def: DEF(
      '\\w*(?:extractJson|parseJsonFrom\\w*|jsonFrom\\w*|parseLooseJson|firstJson\\w*|pickJson\\w*|tryParseJson\\w*|parseModelJson\\w*)\\w*',
    ),
  },
  'same-retry': {
    title: '재시도·시간 제한',
    def: DEF('\\w*(?:withTimeout|retry\\w*|withRetry|timeoutAfter|raceTimeout|sleep|delay|backoff\\w*)'),
  },
  'same-settings': {
    title: '설정 읽기',
    def: DEF(
      '\\w*(?:readSetting\\w*|loadSettings\\w*|readSettingsFile|getSetting\\w*|settingValue\\w*|loadConfig\\w*)',
    ),
  },
  'same-plaincard': {
    title: '쉬운 말 카드 문구 만들기',
    def: DEF(
      '\\w*(?:[pP]lain\\w*|toPlain\\w*|cardText\\w*|cardMessage\\w*|explain\\w*Card|easyWords?\\w*|plainKorean\\w*)',
    ),
  },
  'same-approval-ui': {
    title: '승인·확인 카드 화면 컴포넌트',
    def: /export\s+function\s+(\w*(?:Approval|Confirm|Plan|Choice|Decision)\w*Card\w*)\s*\(/g,
    only: /apps\/web\//,
  },
  'same-engine-args': {
    title: '엔진 실행 인자 만들기',
    def: DEF('\\w*(?:build\\w*Args|\\w*ArgsFor|argsFor\\w*|cliArgs\\w*|toArgv\\w*)'),
  },
  'same-mask': { title: '비밀 마스킹', def: DEF('\\w*(?:mask\\w*|redact\\w*|sanitize\\w*|scrub\\w*)') },
};
const run1 = (key) => {
  const a = AREAS[key];
  const out = [];
  for (const f of files) {
    if (a.only && !a.only.test(f)) continue;
    const t = readFileSync(join(root, f), 'utf8');
    for (const m of t.matchAll(new RegExp(a.def.source, a.def.flags))) {
      const name = m[1] ?? m[2];
      if (!name) continue;
      out.push({
        name,
        file: f,
        line: t.slice(0, m.index).split('\n').length,
        exported: /^export/.test(m[0]),
      });
    }
  }
  writeJson(join(rawDir, `${key}.json`), {
    area: a.title,
    implementations: out.length,
    files: [...new Set(out.map((o) => o.file))].length,
    list: out,
  });
  console.log(
    `${key} (${a.title}): 구현 ${out.length}개, 파일 ${[...new Set(out.map((o) => o.file))].length}개`,
  );
};
const k = process.argv[2] ?? 'all';
for (const key of k === 'all' ? Object.keys(AREAS) : [k]) run1(key);
