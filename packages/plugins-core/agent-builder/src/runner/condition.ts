/**
 * 엣지 when·loop until 조건식 해석기 (작고 결정적인 부분 언어)
 *   output.verdict == 'pass' && iteration < 3
 *   !output.ok || output.score >= 0.8
 * 지원: 경로(a.b.c, a[0]), 문자열('…' "…"), 숫자, true/false/null, == != > >= < <=, && || !, 괄호.
 * 없는 경로는 undefined. 함수 호출·대입은 없다.
 */

type Tok =
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'id'; v: string }
  | { k: 'op'; v: string }
  | { k: 'end' };

export class ConditionError extends Error {
  constructor(
    readonly expr: string,
    message: string,
  ) {
    super(`조건식 오류 (${expr}): ${message}`);
    this.name = 'ConditionError';
  }
}

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      let s = '';
      while (j < src.length && src[j] !== c) {
        if (src[j] === '\\' && j + 1 < src.length) j++;
        s += src[j];
        j++;
      }
      if (j >= src.length) throw new ConditionError(src, '닫히지 않은 문자열');
      out.push({ k: 'str', v: s });
      i = j + 1;
      continue;
    }
    const num = /^-?\d+(\.\d+)?/.exec(src.slice(i));
    if (num && (c !== '-' || out.length === 0 || out[out.length - 1]!.k === 'op')) {
      out.push({ k: 'num', v: Number(num[0]) });
      i += num[0].length;
      continue;
    }
    const id = /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*|\[\d+\])*/.exec(src.slice(i));
    if (id) {
      out.push({ k: 'id', v: id[0] });
      i += id[0].length;
      continue;
    }
    const op = /^(==|!=|>=|<=|&&|\|\||[<>!()])/.exec(src.slice(i));
    if (op) {
      out.push({ k: 'op', v: op[0] });
      i += op[0].length;
      continue;
    }
    throw new ConditionError(src, `알 수 없는 문자 '${c}'`);
  }
  out.push({ k: 'end' });
  return out;
}

export function lookupPath(scope: unknown, path: string): unknown {
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.');
  let cur: unknown = scope;
  for (const p of parts) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

/** 조건식 평가 → boolean (값의 참/거짓) */
export function evaluateCondition(expr: string, scope: Record<string, unknown>): boolean {
  return Boolean(evaluateExpression(expr, scope));
}

export function evaluateExpression(expr: string, scope: Record<string, unknown>): unknown {
  const toks = tokenize(expr);
  let pos = 0;
  const peek = () => toks[pos]!;
  const isOp = (v: string) => {
    const t = peek();
    return t.k === 'op' && t.v === v;
  };

  const primary = (): unknown => {
    const t = toks[pos++]!;
    if (t.k === 'num' || t.k === 'str') return t.v;
    if (t.k === 'id') {
      if (t.v === 'true') return true;
      if (t.v === 'false') return false;
      if (t.v === 'null') return null;
      if (t.v === 'undefined') return undefined;
      return lookupPath(scope, t.v);
    }
    if (t.k === 'op' && t.v === '(') {
      const v = or();
      if (!isOp(')')) throw new ConditionError(expr, "')' 필요");
      pos++;
      return v;
    }
    if (t.k === 'op' && t.v === '!') return !primary();
    throw new ConditionError(expr, '값이 필요한 자리');
  };

  const cmp = (): unknown => {
    const left = primary();
    const t = peek();
    if (t.k === 'op' && ['==', '!=', '>', '>=', '<', '<='].includes(t.v)) {
      pos++;
      const right = primary();
      switch (t.v) {
        case '==':
          return left === right;
        case '!=':
          return left !== right;
        case '>':
          return (left as number) > (right as number);
        case '>=':
          return (left as number) >= (right as number);
        case '<':
          return (left as number) < (right as number);
        default:
          return (left as number) <= (right as number);
      }
    }
    return left;
  };

  const and = (): unknown => {
    let v = cmp();
    while (isOp('&&')) {
      pos++;
      const r = cmp();
      v = Boolean(v) && Boolean(r);
    }
    return v;
  };

  const or = (): unknown => {
    let v = and();
    while (isOp('||')) {
      pos++;
      const r = and();
      v = Boolean(v) || Boolean(r);
    }
    return v;
  };

  const v = or();
  if (peek().k !== 'end') throw new ConditionError(expr, '식 끝에 남은 토큰');
  return v;
}
