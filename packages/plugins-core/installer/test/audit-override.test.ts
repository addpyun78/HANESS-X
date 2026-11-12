// T-102 E.C1-002.1 재현: 설치 어댑터가 부모(CommandAdapter) 메서드를 덮어쓸 때 override 표시가 있어야 한다
// (noImplicitOverride로 이 패키지를 검사해 TS4114가 0개)
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const ts = require('typescript') as typeof import('typescript');
const tsconfig = fileURLToPath(new URL('../tsconfig.json', import.meta.url));

describe('설치 어댑터 override 표시 (T-102 C1-002)', () => {
  it('noImplicitOverride 검사에서 TS4114 0개', () => {
    const cfg = ts.getParsedCommandLineOfConfigFile(
      tsconfig,
      { noImplicitOverride: true, noEmit: true },
      {
        ...ts.sys,
        onUnRecoverableConfigFileDiagnostic: () => {},
      },
    )!;
    const program = ts.createProgram(cfg.fileNames, {
      ...cfg.options,
      noImplicitOverride: true,
      noEmit: true,
    });
    const missing = ts
      .getPreEmitDiagnostics(program)
      .filter((d) => d.code === 4114)
      .map(
        (d) =>
          `${d.file?.fileName.split('/').pop()}:${d.file ? d.file.getLineAndCharacterOfPosition(d.start ?? 0).line + 1 : 0}`,
      );
    expect(missing).toEqual([]);
  }, 120_000);
});
