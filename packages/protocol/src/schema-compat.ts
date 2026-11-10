/**
 * 노드 간 데이터 계약 — 정적 호환성 검사.
 * 앞 노드의 outputSchema가 뒷 노드의 inputSchema를 만족시키는지 JSON Schema 일부(type·properties·
 * required·items·enum)만 보고 판정한다. 빌더(연결선 빨간 표시)와 T-042 실행기 검사가 함께 쓴다.
 *
 * 규칙
 * - 한쪽 스키마가 없으면 판단 불가 → 호환으로 본다.
 * - 입력이 required로 요구하는 필드는 출력이 properties에 선언하고 required로 보장해야 한다.
 * - 같은 이름 필드의 type은 출력 ⊆ 입력이어야 한다 (integer는 number에 들어간다).
 * - enum: 출력 enum ⊆ 입력 enum. 입력에 enum이 있는데 출력에 없으면 비호환.
 * - 배열은 items, 객체는 properties를 재귀적으로 검사.
 */

export type JsonSchemaLike = Record<string, unknown>;

export interface SchemaCompatIssue {
  /** 필드 경로 (예: 'tasks', 'meta.owner', 'items[]') — 최상위는 '' */
  path: string;
  message: string;
}

export interface SchemaCompatResult {
  compatible: boolean;
  issues: SchemaCompatIssue[];
}

export function checkSchemaCompat(
  output: JsonSchemaLike | undefined,
  input: JsonSchemaLike | undefined,
): SchemaCompatResult {
  const issues: SchemaCompatIssue[] = [];
  if (output && input) compare(output, input, '', issues);
  return { compatible: issues.length === 0, issues };
}

/** 사람이 읽을 사유 한 줄씩 (툴팁·오류 메시지용) */
export function formatSchemaCompatIssues(issues: readonly SchemaCompatIssue[]): string {
  return issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)).join('\n');
}

function types(s: JsonSchemaLike): string[] | undefined {
  const t = s.type;
  if (typeof t === 'string') return [t];
  if (Array.isArray(t)) return t.filter((x): x is string => typeof x === 'string');
  if (isObj(s.properties)) return ['object'];
  if (isObj(s.items)) return ['array'];
  return undefined;
}

const typeFits = (out: string, inTypes: string[]) =>
  inTypes.includes(out) || (out === 'integer' && inTypes.includes('number'));

function compare(out: JsonSchemaLike, inp: JsonSchemaLike, path: string, issues: SchemaCompatIssue[]) {
  const to = types(out);
  const ti = types(inp);
  if (to && ti) {
    const bad = to.filter((t) => !typeFits(t, ti));
    if (bad.length) {
      issues.push({ path, message: `타입 불일치: 출력 ${to.join('|')} → 입력 ${ti.join('|')}` });
      return;
    }
  }

  if (Array.isArray(inp.enum)) {
    if (!Array.isArray(out.enum))
      issues.push({ path, message: `입력은 값 목록(${inp.enum.join(', ')})만 받음` });
    else {
      const extra = out.enum.filter((v) => !(inp.enum as unknown[]).includes(v));
      if (extra.length) issues.push({ path, message: `입력이 받지 않는 값: ${extra.join(', ')}` });
    }
  }

  const isObject = (ti ?? []).includes('object') || isObj(inp.properties);
  if (isObject) {
    const outProps = isObj(out.properties) ? out.properties : {};
    const inProps = isObj(inp.properties) ? inp.properties : {};
    const outReq = strings(out.required);
    for (const field of strings(inp.required)) {
      const p = join(path, field);
      if (!(field in outProps)) issues.push({ path: p, message: '필수 입력 필드를 출력이 제공하지 않음' });
      else if (!outReq.includes(field))
        issues.push({ path: p, message: '출력에서 선택 필드 (항상 오지 않음)' });
    }
    for (const [field, inSub] of Object.entries(inProps)) {
      const outSub = outProps[field];
      if (isObj(outSub) && isObj(inSub)) compare(outSub, inSub, join(path, field), issues);
    }
  }

  const isArray = (ti ?? []).includes('array');
  if (isArray && isObj(out.items) && isObj(inp.items)) compare(out.items, inp.items, `${path}[]`, issues);
}

const join = (path: string, field: string) => (path ? `${path}.${field}` : field);

function isObj(v: unknown): v is Record<string, JsonSchemaLike> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}
