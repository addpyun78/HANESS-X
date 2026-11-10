import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { draftSpec, type InterviewAnswers } from '../../src/interview.js';
import { applyFiles, scaffoldFromSpec } from '../../src/scaffold.js';
import { ForgeSpecSchema, type ForgeSpec, type ForgeSpecInput } from '../../src/spec.js';

export const KOTLIN_REQ = 'PR 전에 Kotlin 린트 실패 시 막는 훅 만들어줘';

export const KOTLIN_ANSWERS: InterviewAnswers = {
  kind: { value: 'hook' },
  trigger: { value: 'tool.before' },
  io: { value: 'command-decision' },
  permissions: { value: ['shell'] },
  example: { value: 'fail-blocks' },
};

export const kotlinSpec = (patch: Partial<ForgeSpecInput> = {}): ForgeSpec =>
  ForgeSpecSchema.parse({ ...draftSpec(KOTLIN_REQ, KOTLIN_ANSWERS), ...patch });

/** 임시 폴더에 spec으로 템플릿을 펼치고 files를 얹은 플러그인 */
export function samplePlugin(spec: ForgeSpec, files: Record<string, string> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'hx-forge-sample-'));
  const dir = join(root, spec.id);
  scaffoldFromSpec(spec, dir);
  applyFiles(dir, files);
  return { root, dir, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
