// @features F-079
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  JSON_SCHEMA_DRAFT,
  settingFields,
  settingsJsonSchema,
  type JsonSchema,
} from '../src/settings/json-schema.js';
import { settingsRegistry } from '../src/settings/registry.js';

const dir = mkdtempSync(join(tmpdir(), 'hx-settings-schema-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('T-101 0A.4 Zod → JSON Schema + 메타', () => {
  const file = join(dir, 'settings.schema.json');
  writeFileSync(file, JSON.stringify(settingsJsonSchema(), null, 2));
  const gen = JSON.parse(readFileSync(file, 'utf8')) as JsonSchema;

  it('생성 파일: draft 2020-12, 그룹 목록, 모든 키가 들어 있다', () => {
    expect(gen.$schema).toBe(JSON_SCHEMA_DRAFT);
    expect((gen['x-harness-groups'] as unknown[]).length).toBe(13);
    const props = gen.properties as Record<string, JsonSchema>;
    const judge = props.judge!.properties as Record<string, JsonSchema>;
    expect(judge.samples).toMatchObject({
      type: 'integer',
      minimum: 1,
      maximum: 3,
      default: 3,
      title: '여러 번 물어보기',
      'x-harness': { key: 'judge.samples', group: 'judge', advanced: true, restartRequired: true },
    });
    expect((judge.local!.properties as Record<string, JsonSchema>).timeoutMs!.default).toBe(20000);
    const ext = gen['x-harness-external'] as Record<string, JsonSchema>;
    // settings.json 밖(엔진 파일·키체인·브라우저)에 저장되는 키 = 레지스트리에서 storage가 settings가 아닌 것 + engines
    const external = settingsRegistry
      .list()
      .filter((d) => (d.storage ?? 'settings') !== 'settings')
      .map((d) => d.key);
    expect(Object.keys(ext).sort()).toEqual(external.sort());
    expect(Object.keys(ext)).toEqual(
      expect.arrayContaining(['engines', 'tools.braveKey', 'ui.theme', 'voice.provider']),
    );
    expect(ext['tools.braveKey']!['x-harness']).toMatchObject({ storage: 'keychain', widget: 'secret' });
    // 모든 레지스트리 키가 정확히 한 번 나온다
    const seen: string[] = Object.keys(ext);
    const walk = (s: JsonSchema) => {
      const m = s['x-harness'] as { key?: string } | undefined;
      if (m?.key) seen.push(m.key);
      for (const c of Object.values((s.properties ?? {}) as Record<string, JsonSchema>)) walk(c);
    };
    walk(gen);
    expect(seen.sort()).toEqual(settingsRegistry.keys().sort());
  });

  it('생성 파일 유효성: JSON Schema로 다시 읽어 검사기를 만들면 기본값은 통과, 잘못된 값은 거부', () => {
    const v = z.fromJSONSchema(gen as never);
    expect(v.safeParse({}).success).toBe(true);
    expect(v.safeParse({ judge: { samples: 2, semantic: 'off' }, tools: { budget: 'any' } }).success).toBe(
      true,
    );
    expect(v.safeParse({ judge: { samples: 7 } }).success).toBe(false);
    expect(v.safeParse({ judge: { semantic: 'maybe' } }).success).toBe(false);
    expect(v.safeParse({ builder: { animation: 'yes' } }).success).toBe(false);
  });

  it('키별 field: 위젯 추론(boolean·enum·number·string) + 기본값', () => {
    const by = Object.fromEntries(settingFields().map((f) => [f.key, f]));
    expect(by['builder.animation']).toMatchObject({ widget: 'boolean', default: true, storage: 'settings' });
    expect(by['tools.budget']).toMatchObject({ widget: 'enum', default: 'free-first' });
    expect(by['judge.samples']!.widget).toBe('number');
    expect(by['tools.searxng']!.widget).toBe('string');
    expect(by['judge.engine']!.widget).toBe('engine');
    expect(by['tools.braveKey']).toMatchObject({ widget: 'secret', default: null });
  });
});
