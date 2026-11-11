import { z } from 'zod';
import {
  SETTING_GROUPS,
  settingsRegistry,
  type SettingDef,
  type SettingsRegistry,
  type SettingMeta,
  type SettingWidget,
} from './registry.js';

/**
 * T-101 0A.4 Zod → JSON Schema (+ 메타). 설정 화면은 키마다 붙은 JSON Schema(`schema`)와
 * 메타(`x-harness`)만 보고 위젯을 고른다 — 플러그인 configSchema(원래 JSON Schema)도 같은 모양으로 들어간다.
 */

export const SETTINGS_SCHEMA_ID = 'https://harness-x.local/schemas/settings.json';
export const JSON_SCHEMA_DRAFT = 'https://json-schema.org/draft/2020-12/schema';

export type JsonSchema = Record<string, unknown>;

/** 화면이 받는 키 하나 (GET /api/settings의 fields[]) */
export interface SettingField extends Omit<SettingMeta, 'widget' | 'storage'> {
  key: string;
  path: readonly string[];
  widget: SettingWidget;
  storage: NonNullable<SettingMeta['storage']>;
  /** 기본값 (키체인처럼 없으면 null) */
  default: unknown;
  /** 이 값 하나의 JSON Schema */
  schema: JsonSchema;
}

/** 키 하나의 JSON Schema (메타 없음) */
export function valueJsonSchema(def: Pick<SettingDef, 'schema'>): JsonSchema {
  const js = z.toJSONSchema(def.schema, {
    io: 'input',
    unrepresentable: 'any',
    target: 'draft-2020-12',
  }) as JsonSchema;
  delete js.$schema;
  return js;
}

/** JSON Schema 모양으로 기본 위젯 고르기 */
export function inferWidget(js: JsonSchema): SettingWidget {
  if (Array.isArray(js.enum)) return 'enum';
  const t = Array.isArray(js.type) ? js.type.find((x) => x !== 'null') : js.type;
  if (t === 'boolean') return 'boolean';
  if (t === 'number' || t === 'integer') return 'number';
  if (t === 'array') return 'array';
  return 'string';
}

export function settingField(def: SettingDef, registry: SettingsRegistry = settingsRegistry): SettingField {
  const { schema: _s, storage, widget, ...meta } = def;
  const js = valueJsonSchema(def);
  const dflt = registry.defaultOf(def.key);
  return {
    ...meta,
    storage: storage ?? 'settings',
    widget: widget ?? inferWidget(js),
    default: dflt === undefined ? null : dflt,
    schema: js,
  };
}

export function settingFields(registry: SettingsRegistry = settingsRegistry): SettingField[] {
  return registry.list().map((d) => settingField(d, registry));
}

/** x-harness 메타 (JSON Schema 안에 붙는 모양) */
function harnessMeta(f: SettingField): JsonSchema {
  const { schema: _s, path: _p, default: _d, title: _t, description: _desc, ...rest } = f;
  return rest as unknown as JsonSchema;
}

/**
 * settings.json 전체의 JSON Schema. storage 'settings' 키는 중첩 properties로,
 * 그 밖(엔진 파일·키체인·브라우저)은 `x-harness-external`에 같은 모양으로 담는다.
 */
export function settingsJsonSchema(registry: SettingsRegistry = settingsRegistry): JsonSchema {
  const root: JsonSchema = {
    $schema: JSON_SCHEMA_DRAFT,
    $id: SETTINGS_SCHEMA_ID,
    title: '하네스 설정',
    type: 'object',
    properties: {},
    'x-harness-groups': SETTING_GROUPS.map((g) => ({ ...g })),
  };
  const external: Record<string, JsonSchema> = {};
  for (const f of settingFields(registry)) {
    const leaf: JsonSchema = {
      ...f.schema,
      title: f.title,
      description: f.description,
      'x-harness': harnessMeta(f),
    };
    if (f.storage !== 'settings') {
      external[f.key] = leaf;
      continue;
    }
    let cur = root;
    f.path.forEach((seg, i) => {
      const props = (cur.properties ??= {}) as Record<string, JsonSchema>;
      if (i === f.path.length - 1) props[seg] = leaf;
      else cur = props[seg] ??= { type: 'object', properties: {} };
    });
  }
  root['x-harness-external'] = external;
  return root;
}
