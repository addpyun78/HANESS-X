/**
 * T-101 0-1 설정 폼 — 커널 GET /api/settings 응답 모양
 * (packages/kernel/src/settings/json-schema.ts SettingField · store.ts SettingValueState)
 * 웹은 커널을 실행 중에 불러오지 않으므로 구조만 옮겨 적는다.
 */

export type SettingGroupId = string;
export type SettingScope = 'global' | 'project' | 'both';
export type SettingWidget =
  | 'boolean'
  | 'enum'
  | 'number'
  | 'string'
  | 'array'
  | 'engine'
  | 'model'
  | 'secret'
  | 'folder'
  | 'engine-settings';
export type SettingStorage = 'settings' | 'engines-file' | 'keychain' | 'browser';
export type SaveScope = 'global' | 'project';

export interface JsonSchema {
  type?: string | string[];
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  items?: JsonSchema;
  default?: unknown;
  [k: string]: unknown;
}

export interface SettingGroup {
  id: SettingGroupId;
  title: string;
  description: string;
}

export interface SettingField {
  key: string;
  path: readonly string[];
  group: SettingGroupId;
  title: string;
  description: string;
  advanced: boolean;
  restartRequired: boolean;
  scope: SettingScope;
  widget: SettingWidget;
  storage: SettingStorage;
  options?: Readonly<Record<string, string>>;
  secretAccount?: string;
  browserKey?: string;
  engineKey?: string;
  plugin?: { id: string; title: string };
  /** T-102 C2-004 아직 효과가 없는 설정: 비활성 + "준비 중이에요" */
  notReady?: string;
  default: unknown;
  schema: JsonSchema;
}

export interface SettingValueState {
  effective: unknown;
  source: 'default' | 'global' | 'project';
  global?: unknown;
  project?: unknown;
  invalid?: string;
  masked?: string | null;
}

export interface SettingsResponse {
  groups: SettingGroup[];
  fields: SettingField[];
  values: Record<string, SettingValueState>;
  projectSettings?: boolean;
}

export interface SaveResponse {
  ok: true;
  key: string;
  state: SettingValueState;
  restartRequired: boolean;
  notice?: string;
}

export type ResetTarget = { key: string } | { group: string } | { all: true };
