import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  AssistSettingsSchema,
  ToolsSettingsSchema,
} from '../packages/plugins-core/tool-finder/src/settings.js';
import { BuilderSettingsSchema } from '../packages/plugins-core/agent-builder/src/designer/settings.js';
import { JudgeSettingsSchema } from '../packages/plugins-core/verifiers/judge/src/settings.js';
import { EnginesSettingsSchema } from '../packages/kernel/src/engines-settings.js';
import {
  scanSourceText,
  scanSourceTree,
  schemaKeys,
  unregisteredHits,
  type CodeKeyHit,
} from '../packages/kernel/src/settings/coverage.js';
import { settingsRegistry } from '../packages/kernel/src/settings/registry.js';

/**
 * T-101 0A.3·0A.10 재발 방지 검사: 코드에서 쓰는 설정 키 ⊆ 레지스트리 키.
 * 새 설정 키를 쓰는 코드를 넣고 레지스트리(packages/kernel/src/settings/registry.ts)에 등록하지 않으면 이 테스트가 실패한다.
 * (레지스트리 키가 화면에 전부 보이는지는 apps/web/test/settings.form.coverage.test.tsx)
 */

const root = fileURLToPath(new URL('..', import.meta.url));
const at = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));

/** settings.json 구역을 읽는 Zod 스키마들 (구역 이름 → 스키마) */
const SECTION_SCHEMAS: [string, Parameters<typeof schemaKeys>[1]][] = [
  ['judge', JudgeSettingsSchema],
  ['builder', BuilderSettingsSchema],
  ['tools', ToolsSettingsSchema],
  ['assist', AssistSettingsSchema],
];

const fmt = (h: readonly CodeKeyHit[]) => h.map((x) => `${x.key} (${x.how}: ${x.file}:${x.line})`);

describe('T-101 0A.10 코드에서 쓰는 설정 키 ⊆ 레지스트리', () => {
  it('설정 구역 Zod 스키마의 모든 키가 등록돼 있다', () => {
    const hits: CodeKeyHit[] = SECTION_SCHEMAS.flatMap(([ns, s]) =>
      schemaKeys(ns, s).map((key) => ({ key, file: `schema:${ns}`, line: 0, how: 'schema' as const })),
    );
    expect(hits.map((h) => h.key)).toContain('judge.local.timeoutMs');
    expect(fmt(unregisteredHits(hits))).toEqual([]);
    // 엔진 설정 파일(engines-settings.yaml)의 최상위 키
    for (const k of Object.keys(EnginesSettingsSchema.shape)) expect(settingsRegistry.has(k), k).toBe(true);
  });

  it('소스 전체(packages·apps): readSetting 호출·settings.json 파일의 키 글자·브라우저 저장 이름이 모두 등록돼 있다', () => {
    const hits = scanSourceTree([at('packages'), at('apps')], root);
    // 조사 기준선(0A.1)에서 찾은 것들이 실제로 잡히는지
    const keys = new Set(hits.map((h) => h.key));
    for (const k of ['judge.semantic', 'judge.engine', 'hx-theme', 'hx.stt.provider', 'hx-token'])
      expect(keys).toContain(k);
    expect(fmt(unregisteredHits(hits))).toEqual([]);
  });

  it('일부러 미등록 키를 넣으면 실패한다 (검사가 실제로 잡는지)', () => {
    const fake = [
      "const m = readSetting(values, 'mode.secretKnob');",
      "const n = readSetting<number>(cfg(), 'attachments.maxFileMb');",
      "const f = join(home, 'settings.json'); to['judge.secretKnob'] = 1;",
      "export const FOO_KEY = 'hx.foo.bar';",
      "const ok = readSetting(v, 'judge.samples');",
    ].join('\n');
    const bad = unregisteredHits(scanSourceText('fake.ts', fake));
    expect(bad.map((h) => [h.key, h.how])).toEqual([
      ['mode.secretKnob', 'readSetting'],
      ['attachments.maxFileMb', 'readSetting'],
      ['judge.secretKnob', 'literal'],
      ['hx.foo.bar', 'browser'],
    ]);
    // 설정 구역 스키마에 새 필드를 넣고 등록하지 않은 경우
    const grown = JudgeSettingsSchema.extend({ newKnob: JudgeSettingsSchema.shape.samples });
    expect(
      unregisteredHits(
        schemaKeys('judge', grown).map((key) => ({ key, file: 's', line: 0, how: 'schema' as const })),
      ).map((h) => h.key),
    ).toEqual(['judge.newKnob']);
  });
});
