import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { harnessHome } from '@harness-x/kernel';
import { HARNESS_TOOLS, MCP_SERVER_NAME } from '@harness-x/mcp-host';
import { pluginHealth } from './health.js';
import type { InventoryPluginSource } from './plugins.js';
import type { McpServerAsset, ToolAsset } from './schema.js';

/**
 * P4-A.5 도구·MCP 서버 수집
 * - 도구 목록(Part 2): ~/.harness-x/tools/registry.json — @harness-x/installer가 만든다.
 *   형식이 바뀌어도 깨지지 않도록 여기서는 최소 필드만 느슨하게 읽는다(모르는 값은 unknown).
 * - tool 슬롯 플러그인: 매니페스트의 이름·설명·권한
 * - MCP 서버: mcp-host 플러그인이 엔진에 여는 하네스 MCP 서버와 그 도구 목록
 */

export function defaultToolRegistryFile(): string {
  return join(harnessHome(), 'tools', 'registry.json');
}

/** registry.json 항목의 최소 모양 (나머지 필드는 무시) */
export const RegistryToolEntrySchema = z.looseObject({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  kind: z.string().optional(),
  version: z.string().optional(),
  pricing: z.unknown().optional(),
  purpose: z.string().optional(),
  capabilities: z.array(z.string()).optional(),
});
export type RegistryToolEntry = z.infer<typeof RegistryToolEntrySchema>;

/** 'free'·'paid' 또는 { kind|type: 'free' … } 모양을 받아 free|paid|unknown */
export function normalizePricing(v: unknown): ToolAsset['pricing'] {
  const s =
    typeof v === 'string'
      ? v
      : v && typeof v === 'object'
        ? ((v as Record<string, unknown>).kind ?? (v as Record<string, unknown>).type)
        : undefined;
  return s === 'free' || s === 'paid' ? s : 'unknown';
}

/** registry.json 읽기: 없거나 깨지면 [], 항목 단위로 잘못된 것은 건너뛴다 */
export function readToolRegistry(file = defaultToolRegistryFile()): RegistryToolEntry[] {
  if (!existsSync(file)) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return [];
  }
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { tools?: unknown }).tools)
      ? (raw as { tools: unknown[] }).tools
      : [];
  const out: RegistryToolEntry[] = [];
  for (const item of list) {
    const r = RegistryToolEntrySchema.safeParse(item);
    if (r.success) out.push(r.data);
  }
  return out;
}

export function collectTools(
  registry: readonly RegistryToolEntry[],
  plugins: Iterable<InventoryPluginSource>,
): ToolAsset[] {
  const out: ToolAsset[] = registry.map((t) => ({
    id: t.id,
    name: t.name ?? t.id,
    kind: t.kind ?? 'unknown',
    ...(t.version ? { version: t.version } : {}),
    pricing: normalizePricing(t.pricing),
    purpose: t.purpose ?? '',
    capabilities: [...(t.capabilities ?? [])],
    source: 'registry' as const,
    health: 'ready' as const,
  }));
  const seen = new Set(out.map((t) => t.id));
  for (const p of plugins) {
    const m = p.manifest;
    if (m.id === MCP_HOST_PLUGIN) continue; // MCP 서버로 따로 센다
    for (const id of m.provides.tool ?? []) {
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({
        id,
        name: m.displayName ?? id,
        kind: 'plugin',
        version: m.version,
        // 하네스 플러그인 도구는 로컬 실행 — 유료 여부는 매니페스트에 없으므로 unknown
        pricing: 'unknown',
        purpose: m.description ?? '',
        capabilities: [],
        source: 'plugin',
        permissions: {
          fs: [...(m.permissions?.fs ?? [])],
          net: [...(m.permissions?.net ?? [])],
          shell: m.permissions?.shell ?? false,
        },
        health: pluginHealth(p),
      });
    }
  }
  return out;
}

export const MCP_HOST_PLUGIN = 'mcp-host';

const HARNESS_TOOL_DESC: Record<(typeof HARNESS_TOOLS)[number], string> = {
  'checklist.propose': '작업 체크리스트를 제안한다',
  'checklist.start': '체크리스트 항목을 시작한다',
  'checklist.submit': '항목을 증거와 함께 제출한다 (판정은 하네스)',
  'checklist.current': '지금 할 항목과 정식 경로를 알려 준다',
  'manifest.resolve': '산출물 ID의 정식 경로를 알려 준다',
};

export function collectMcpServers(plugins: Iterable<InventoryPluginSource>): McpServerAsset[] {
  const out: McpServerAsset[] = [];
  for (const p of plugins) {
    if (p.manifest.id !== MCP_HOST_PLUGIN) continue;
    const m = p.manifest;
    out.push({
      id: MCP_SERVER_NAME,
      name: m.displayName ?? MCP_SERVER_NAME,
      description: m.description ?? '',
      pluginId: m.id,
      tools: HARNESS_TOOLS.map((name) => ({ name, description: HARNESS_TOOL_DESC[name] })),
      permissions: {
        fs: [...(m.permissions?.fs ?? [])],
        net: [...(m.permissions?.net ?? [])],
        shell: m.permissions?.shell ?? false,
      },
      health: pluginHealth(p),
    });
  }
  return out;
}
