import {
  checkSchemaCompat,
  formatSchemaCompatIssues,
  type HarnessEvent,
  type JsonSchemaObject,
  type Pipeline,
  type PipelineNode,
  type SchemaCompatIssue,
} from '@harness-x/protocol';

/**
 * 노드 간 데이터 계약 (T-042)
 * - 42.1 출력 추출(결정적): ① MCP 도구 node.output(json)의 마지막 호출 → ② 마지막 assistant 텍스트의 마지막 JSON 블록.
 *        outputSchema가 있으면 그 properties에 선언된 필드만, 선언 순서대로 남긴다.
 * - 42.2 검증 실패 시 같은 노드에 누락·잘못된 필드 목록으로 재요청 (실행기가 최대 2회)
 * - 42.3 다음 노드 프롬프트에는 값 자체를 JSON으로 넣는다 (파일 링크·경로 참조가 아니라)
 * - 42.4 연결 시 정적 호환성 검사 (protocol checkSchemaCompat)
 */

export const NODE_OUTPUT_TOOL = 'node.output';
export const MAX_CONTRACT_RETRIES = 2;

/** node.output 도구 이름인가 (엔진별 접두: mcp__harness__node.output, harness.node.output, node_output …) */
export function isNodeOutputTool(name: string): boolean {
  return /(^|[._]|__)node[._]output$/.test(name);
}

export type OutputSource = 'tool' | 'json_block' | 'none';

export interface ExtractedOutput {
  source: OutputSource;
  /** 스키마 필드만 고른 값 (스키마가 없으면 찾은 객체 그대로) */
  value: Record<string, unknown> | undefined;
  /** 찾은 원본 */
  raw?: unknown;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function tryParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

/** 텍스트 안 JSON 객체 후보들 (등장 순서): ```json 펜스 → 그 밖의 균형 잡힌 {...} */
export function jsonBlocks(text: string): Record<string, unknown>[] {
  const found: { at: number; value: Record<string, unknown> }[] = [];
  const fence = /```(?:json|JSON)?[ \t]*\n([\s\S]*?)```/g;
  const covered: [number, number][] = [];
  for (let m; (m = fence.exec(text));) {
    const v = tryParse(m[1]!.trim());
    covered.push([m.index, m.index + m[0].length]);
    if (isRecord(v)) found.push({ at: m.index, value: v });
  }
  // 펜스 밖의 맨몸 JSON 객체
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '{' || covered.some(([a, b]) => i >= a && i < b)) continue;
    const end = balancedEnd(text, i);
    if (end < 0) continue;
    const v = tryParse(text.slice(i, end + 1));
    if (isRecord(v)) {
      found.push({ at: i, value: v });
      i = end;
    }
  }
  return found.sort((a, b) => a.at - b.at).map((f) => f.value);
}

function balancedEnd(s: string, start: number): number {
  let depth = 0;
  let inStr = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (c === '\\') i++;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i;
  }
  return -1;
}

/** 스키마 properties에 선언된 필드만, 선언 순서대로 */
export function pickSchemaFields(
  value: Record<string, unknown>,
  schema: JsonSchemaObject | undefined,
): Record<string, unknown> {
  const props = schema && isRecord(schema.properties) ? Object.keys(schema.properties) : undefined;
  if (!props) return value;
  const out: Record<string, unknown> = {};
  for (const k of props) if (k in value) out[k] = value[k];
  return out;
}

/** 42.1 노드 이벤트에서 출력 추출 */
export function extractNodeOutput(
  events: readonly HarnessEvent[],
  schema?: JsonSchemaObject,
): ExtractedOutput {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.type !== 'tool_call' || !isNodeOutputTool(e.tool)) continue;
    const input = e.input;
    let raw: unknown = isRecord(input) && 'json' in input ? input.json : input;
    if (typeof raw === 'string') raw = tryParse(raw);
    if (isRecord(raw)) return { source: 'tool', value: pickSchemaFields(raw, schema), raw };
  }
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.type !== 'assistant_text' || e.partial) continue;
    const blocks = jsonBlocks(e.text);
    const last = blocks[blocks.length - 1];
    if (last) return { source: 'json_block', value: pickSchemaFields(last, schema), raw: last };
  }
  return { source: 'none', value: undefined };
}

// ── 검증 ───────────────────────────────────────────────────────
export interface OutputValidation {
  ok: boolean;
  /** 빠진 필수 필드 경로 */
  missing: string[];
  /** 타입·값 목록이 틀린 필드 */
  invalid: { path: string; message: string }[];
}

function typeOk(v: unknown, t: string): boolean {
  switch (t) {
    case 'string':
      return typeof v === 'string';
    case 'number':
      return typeof v === 'number' && Number.isFinite(v);
    case 'integer':
      return Number.isInteger(v);
    case 'boolean':
      return typeof v === 'boolean';
    case 'array':
      return Array.isArray(v);
    case 'object':
      return isRecord(v);
    case 'null':
      return v === null;
    default:
      return true;
  }
}

/** JSON Schema 일부(type·properties·required·items·enum)로 값 검증 */
export function validateOutput(value: unknown, schema: JsonSchemaObject | undefined): OutputValidation {
  const missing: string[] = [];
  const invalid: { path: string; message: string }[] = [];
  const walk = (v: unknown, s: Record<string, unknown>, path: string) => {
    const types = typeof s.type === 'string' ? [s.type] : Array.isArray(s.type) ? (s.type as string[]) : [];
    if (types.length && !types.some((t) => typeOk(v, t))) {
      invalid.push({ path: path || '(값)', message: `${types.join('|')} 타입이어야 함` });
      return;
    }
    if (Array.isArray(s.enum) && !s.enum.includes(v))
      invalid.push({ path: path || '(값)', message: `허용 값: ${s.enum.join(', ')}` });
    if (isRecord(v) && (isRecord(s.properties) || Array.isArray(s.required))) {
      const props = isRecord(s.properties) ? s.properties : {};
      for (const r of Array.isArray(s.required) ? (s.required as string[]) : [])
        if (!(r in v) || v[r] === undefined) missing.push(path ? `${path}.${r}` : r);
      for (const [k, sub] of Object.entries(props))
        if (k in v && v[k] !== undefined && isRecord(sub)) walk(v[k], sub, path ? `${path}.${k}` : k);
    }
    if (Array.isArray(v) && isRecord(s.items))
      v.forEach((x, i) => walk(x, s.items as Record<string, unknown>, `${path}[${i}]`));
  };
  if (!schema) return { ok: true, missing, invalid };
  if (value === undefined) {
    const req = Array.isArray(schema.required) ? (schema.required as string[]) : [];
    return { ok: req.length === 0 && !schema.type, missing: req, invalid };
  }
  walk(value, schema, '');
  return { ok: missing.length === 0 && invalid.length === 0, missing, invalid };
}

// ── 프롬프트 ──────────────────────────────────────────────────
/** 출력 형식 안내 (노드 첫 프롬프트) */
export function outputInstruction(schema: JsonSchemaObject | undefined): string | undefined {
  if (!schema) return undefined;
  const props = isRecord(schema.properties) ? Object.keys(schema.properties) : [];
  const req = Array.isArray(schema.required) ? (schema.required as string[]) : [];
  return [
    '## 출력',
    `결과는 ${NODE_OUTPUT_TOOL} 도구에 JSON 객체로 제출하세요 (도구가 없으면 마지막 답변에 \`\`\`json 블록으로).`,
    props.length ? `필드: ${props.map((p) => (req.includes(p) ? `${p}(필수)` : p)).join(', ')}` : '',
    `스키마:\n\`\`\`json\n${JSON.stringify(schema, null, 2)}\n\`\`\``,
  ]
    .filter(Boolean)
    .join('\n');
}

/** 42.2 재요청 프롬프트: 누락 필드 목록 + 지금까지 받은 값 */
export function contractRetryPrompt(
  v: OutputValidation,
  got: Record<string, unknown> | undefined,
  schema: JsonSchemaObject | undefined,
  attempt: number,
): string {
  const lines = [
    `출력이 이 노드의 outputSchema를 만족하지 않습니다 (재요청 ${attempt}/${MAX_CONTRACT_RETRIES}).`,
  ];
  if (v.missing.length) lines.push(`누락 필드: ${v.missing.join(', ')}`);
  for (const i of v.invalid) lines.push(`잘못된 필드: ${i.path} — ${i.message}`);
  lines.push(`받은 값:\n\`\`\`json\n${JSON.stringify(got ?? null, null, 2)}\n\`\`\``);
  lines.push(
    `누락·잘못된 필드를 채운 전체 JSON 객체를 ${NODE_OUTPUT_TOOL} 도구로 다시 제출하세요 (도구가 없으면 \`\`\`json 블록).`,
  );
  const o = outputInstruction(schema);
  if (o) lines.push(o);
  return lines.join('\n\n');
}

/** 42.3 다음 노드 입력 값: inputSchema가 있으면 선언 필드만 (값 그대로) */
export function selectInputValues(value: unknown, schema: JsonSchemaObject | undefined): unknown {
  if (!isRecord(value)) return value;
  return pickSchemaFields(value, schema);
}

/** 42.3 입력 값을 프롬프트에 값 그대로 넣는다 (파일 링크가 아니라 JSON 본문) */
export function renderInputValues(value: unknown): string {
  const lines = ['## 입력 값 (앞 노드 출력, 값 그대로)'];
  if (isRecord(value)) {
    for (const [k, v] of Object.entries(value))
      lines.push(`- ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
  }
  lines.push('```json\n' + JSON.stringify(value ?? {}, null, 2) + '\n```');
  return lines.join('\n');
}

// ── 42.4 정적 호환성 검사 ──────────────────────────────────────
export interface ConnectionIssue {
  from: string;
  to: string;
  issues: SchemaCompatIssue[];
  message: string;
}

type SchemaNode = Extract<PipelineNode, { type: 'role' | 'subagent' }>;
const hasSchemas = (n: PipelineNode): n is SchemaNode => n.type === 'role' || n.type === 'subagent';

/** 노드 하나 → 다른 노드 연결의 호환성 (빌더 연결선 검사용) */
export function checkConnection(from: PipelineNode, to: PipelineNode): ConnectionIssue | undefined {
  if (!hasSchemas(from) || !hasSchemas(to)) return undefined;
  const r = checkSchemaCompat(from.outputSchema, to.inputSchema);
  if (r.compatible) return undefined;
  return { from: from.id, to: to.id, issues: r.issues, message: formatSchemaCompatIssues(r.issues) };
}

/** 두 출력 스키마를 합친다 (join: 갈래 출력이 한 객체로 모인다) */
function mergeSchemas(list: JsonSchemaObject[]): JsonSchemaObject {
  const properties: Record<string, unknown> = {};
  const required = new Set<string>();
  for (const s of list) {
    if (isRecord(s.properties)) Object.assign(properties, s.properties);
    if (Array.isArray(s.required)) for (const r of s.required) required.add(r as string);
  }
  return { type: 'object', properties, required: [...required] };
}

/**
 * 파이프라인 전체 연결 검사. 일반 엣지 X → Y마다 Y의 inputSchema와 X 쪽 값의 출력 스키마를 비교한다.
 * gate·fanout·loop·router는 값을 그대로 넘기므로 그 상류의 생산 노드까지 거슬러 올라가고,
 * join은 들어오는 갈래 출력 스키마를 합쳐 본다. 생산 노드 스키마를 모르면(없으면) 검사하지 않는다.
 */
export function checkPipelineContracts(p: Pipeline): ConnectionIssue[] {
  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  const normal = p.edges.filter((e) => !e.onFail);
  const preds = (id: string) => normal.filter((e) => e.to === id).map((e) => e.from);

  /** id 노드가 내보내는 값의 스키마 후보 (undefined = 모름) */
  const produced = (
    id: string,
    seen: Set<string>,
  ): { via: string; schema: JsonSchemaObject | undefined }[] => {
    if (seen.has(id)) return [];
    seen.add(id);
    const n = byId.get(id);
    if (!n) return [];
    if (hasSchemas(n)) return [{ via: n.id, schema: n.outputSchema }];
    if (n.type === 'join') {
      const parts = preds(id).flatMap((x) => produced(x, new Set(seen)));
      if (parts.some((x) => !x.schema)) return [{ via: n.id, schema: undefined }];
      return [{ via: parts.map((x) => x.via).join('+'), schema: mergeSchemas(parts.map((x) => x.schema!)) }];
    }
    return preds(id).flatMap((x) => produced(x, seen));
  };

  const issues: ConnectionIssue[] = [];
  const reported = new Set<string>();
  for (const e of normal) {
    const to = byId.get(e.to);
    if (!to || !hasSchemas(to) || !to.inputSchema) continue;
    for (const src of produced(e.from, new Set())) {
      if (!src.schema) continue;
      const r = checkSchemaCompat(src.schema, to.inputSchema);
      const key = `${src.via}>${to.id}`;
      if (r.compatible || reported.has(key)) continue;
      reported.add(key);
      issues.push({
        from: src.via,
        to: to.id,
        issues: r.issues,
        message: formatSchemaCompatIssues(r.issues),
      });
    }
  }
  return issues;
}

export class PipelineContractError extends Error {
  readonly code = 'PIPELINE_CONTRACT';
  constructor(readonly issues: ConnectionIssue[]) {
    super(
      '노드 연결 스키마가 호환되지 않습니다:\n' +
        issues.map((i) => `${i.from} → ${i.to}: ${i.message.replace(/\n/g, '; ')}`).join('\n'),
    );
    this.name = 'PipelineContractError';
  }
}

export function assertPipelineContracts(p: Pipeline): void {
  const issues = checkPipelineContracts(p);
  if (issues.length) throw new PipelineContractError(issues);
}
