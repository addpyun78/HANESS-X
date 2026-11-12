// C5.12 같은 일을 하는 구현끼리 같은 입력 100개(F 단계는 300개)로 결과 비교
// usage: node scripts/audit/same-compare.mjs <path|json|retry|mask|plain> [입력 수=100]
// 내보내지 않은 구현은 원본 파일에서 그 선언만 떼어 TypeScript로 바꿔 실행한다(파일은 고치지 않음)
import { createRequire } from 'node:module';
import { join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { rawDir, readFileSync, root, writeJson } from './lib.mjs';
const require = createRequire(join(root, 'package.json'));
const ts = require('typescript');
const area = process.argv[2];
const N = Number(process.argv[3] ?? 100);
const imp = async (p, name) => (await import(pathToFileURL(join(root, 'packages', p)).href))[name];
/** 소스 파일에서 이름이 name인 최상위 선언(함수·const)을 떼어 실행 가능한 함수로 */
function extract(file, name, scope = {}) {
  const text = readFileSync(join(root, file), 'utf8');
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  let decl;
  for (const s of sf.statements) {
    if (ts.isFunctionDeclaration(s) && s.name?.text === name) decl = s;
    if (
      ts.isVariableStatement(s) &&
      s.declarationList.declarations.some((d) => ts.isIdentifier(d.name) && d.name.text === name)
    )
      decl = s;
  }
  if (!decl) throw new Error(`${file}에 ${name} 없음`);
  const js = ts.transpileModule(decl.getText(sf).replace(/^export\s+/, ''), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return new Function(...Object.keys(scope), `${js}\nreturn ${name};`)(...Object.values(scope));
}
// 결정적 의사 난수
let seed = 42;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const pick = (a) => a[Math.floor(rnd() * a.length)];

const AREAS = {
  async path() {
    const impls = {
      'kernel/path-normalize.ts toPosixForm': await imp('kernel/dist/path-normalize.js', 'toPosixForm'),
      'checklist-ledger/stages/scope.ts normPath': await imp(
        'plugins-core/checklist-ledger/dist/stages/scope.js',
        'normPath',
      ),
      'kernel/pause-snapshot.ts toPosix': extract('packages/kernel/src/pause-snapshot.ts', 'toPosix', {
        sep,
      }),
    };
    const segs = ['src', 'a b', '한글', 'x.ts', '..', '.', 'Mobile', 'node_modules'];
    const inputs = Array.from({ length: N }, () => {
      const parts = Array.from({ length: 1 + Math.floor(rnd() * 4) }, () => pick(segs));
      const s = pick(['/', '\\', '//', '/']);
      return pick(['', './', 'C:\\', 'C:/', '/mnt/c/', '\\\\wsl$\\Ubuntu\\']) + parts.join(s);
    });
    return { impls, inputs };
  },
  async json() {
    const impls = {
      'openai-compat/json-fallback.ts extractJson': extract(
        'packages/engines/openai-compat/src/json-fallback.ts',
        'extractJson',
      ),
      'judge/questions.ts extractJsonObject': await imp(
        'plugins-core/verifiers/judge/dist/questions.js',
        'extractJsonObject',
      ),
      'protocol/verifier.ts extractJsonObject': await imp('protocol/dist/verifier.js', 'extractJsonObject'),
    };
    const objs = [
      '{"a":1}',
      '{"verdict":"pass","n":[1,2]}',
      '{"x":{"y":"}"}}',
      '[1,2]',
      '{bad json}',
      '',
      'plain text',
    ];
    const inputs = Array.from({ length: N }, () => {
      const o = pick(objs);
      return pick([
        o,
        '```json\n' + o + '\n```',
        '답: ' + o + ' 끝',
        '```\n' + o + '\n```',
        o + '\n' + o,
        '  ' + o + '  ',
      ]);
    });
    return { impls, inputs };
  },
  async mask() {
    const impls = {
      'kernel/secrets-mask.ts maskSecrets': await imp('kernel/dist/secrets-mask.js', 'maskSecrets'),
      'attachments/secrets.ts maskSecretText': await imp(
        'plugins-core/attachments/dist/secrets.js',
        'maskSecretText',
      ),
      'kernel/settings/diagnostics.ts redactSecrets': await imp(
        'kernel/dist/settings/diagnostics.js',
        'redactSecrets',
      ),
    };
    const sec = [
      'sk-ant-' + 'a'.repeat(30),
      'AIza' + 'B'.repeat(35),
      'ghp_' + 'c'.repeat(36),
      'xoxb-1234567890-abc',
      'AKIA' + 'D'.repeat(16),
      'Bearer ' + 'e'.repeat(30),
      'password=hunter2hunter2',
      '평범한 글',
    ];
    const inputs = Array.from(
      { length: N },
      () => `${pick(['키: ', 'token ', '', '설정 '])}${pick(sec)} ${pick(['끝', '', '\n다음 줄'])}`,
    );
    return { impls, inputs };
  },
  async plain() {
    const impls = {
      'agent-builder/designer/plain.ts isPlain': await imp(
        'plugins-core/agent-builder/dist/designer/plain.js',
        'isPlain',
      ),
      'tool-finder/reasons.ts isPlain': await imp('plugins-core/tool-finder/dist/reasons.js', 'isPlain'),
    };
    const words = [
      '파일을 저장해요',
      'API 키를 넣어요',
      '스키마가 틀렸어요',
      '버튼을 눌러 주세요',
      'YAML 형식',
      '설치가 끝났어요',
      'JSON 파싱 오류',
      '토큰이 부족해요',
      '쉬운 말이에요',
    ];
    const inputs = Array.from(
      { length: N },
      () => `${pick(words)}${pick(['', ' ', '. ', '!'])}${pick(['', pick(words)])}`,
    );
    return { impls, inputs };
  },
  async retry() {
    // 시간 제한 3종: 같은 약속(p)·시간(ms)을 넣고 결과 종류(값/거절 메시지/대체값)를 비교
    const impls = {
      'kernel/hooks.ts withTimeout': extract('packages/kernel/src/hooks.ts', 'withTimeout', {
        HookTimeout: class HookTimeout extends Error {
          constructor(ms) {
            super(`hook timeout ${ms}ms`);
          }
        },
      }),
      'kernel/loader.ts withTimeout': (p, ms) =>
        extract('packages/kernel/src/loader.ts', 'withTimeout')(p, ms, 'step'),
      'engine-scanner/progress.ts withTimeout': (p, ms) =>
        extract('packages/plugins-core/engine-scanner/src/progress.ts', 'withTimeout')(p, ms, '__fallback__'),
    };
    const inputs = Array.from({ length: N }, () => ({
      kind: pick(['resolve', 'reject', 'slow']),
      delay: Math.floor(rnd() * 3),
      value: Math.floor(rnd() * 100),
    }));
    return { impls, inputs, async: true };
  },
};
const make = (inp) =>
  inp.kind === 'resolve'
    ? Promise.resolve(inp.value)
    : inp.kind === 'reject'
      ? Promise.reject(new Error('boom'))
      : new Promise((r) => setTimeout(() => r(inp.value), 30));
const norm = (v) => (v === undefined ? '<undefined>' : JSON.stringify(v));
const { impls, inputs, async: isAsync } = await AREAS[area]();
const names = Object.keys(impls);
const diffs = [];
for (const inp of inputs) {
  const outs = {};
  for (const n of names) {
    try {
      outs[n] = isAsync
        ? await impls[n](make(inp), 10).then(
            (v) => `값 ${norm(v)}`,
            (e) => `거절 ${e?.constructor?.name}`,
          )
        : norm(impls[n](inp));
    } catch (e) {
      outs[n] = `오류 ${e?.message}`;
    }
  }
  if (new Set(Object.values(outs)).size > 1) diffs.push({ input: inp, outputs: outs });
}
const result = {
  area,
  implementations: names,
  inputs: inputs.length,
  differing: diffs.length,
  examples: diffs.slice(0, 8),
};
writeJson(join(rawDir, `same-compare-${area}${N !== 100 ? '-' + N : ''}.json`), result);
console.log(`${area}: 구현 ${names.length}개 × 입력 ${inputs.length}개 → 결과가 다른 입력 ${diffs.length}개`);
