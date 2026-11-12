// @features F-043
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  checkSchemaCompat,
  formatSchemaCompatIssues,
  parsePipelineYaml,
  type RoleNode,
} from '../src/index.js';

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  properties,
  required,
});

describe('노드 출력 → 입력 스키마 정적 호환성 검사', () => {
  it('스키마가 없으면 호환', () => {
    expect(checkSchemaCompat(undefined, obj({ a: { type: 'string' } }, ['a'])).compatible).toBe(true);
    expect(checkSchemaCompat(obj({}), undefined).compatible).toBe(true);
  });

  it('필수 입력 필드 누락·선택 필드', () => {
    const r = checkSchemaCompat(
      obj({ tasks: { type: 'array' }, note: { type: 'string' } }, ['tasks']),
      obj({ changedFiles: { type: 'array' }, note: { type: 'string' } }, ['changedFiles', 'note']),
    );
    expect(r.compatible).toBe(false);
    expect(r.issues).toEqual([
      { path: 'changedFiles', message: '필수 입력 필드를 출력이 제공하지 않음' },
      { path: 'note', message: '출력에서 선택 필드 (항상 오지 않음)' },
    ]);
    expect(formatSchemaCompatIssues(r.issues)).toContain('changedFiles: 필수 입력 필드');
  });

  it('타입 불일치, integer ⊆ number, 다중 타입', () => {
    const bad = checkSchemaCompat(
      obj({ n: { type: 'string' } }, ['n']),
      obj({ n: { type: 'number' } }, ['n']),
    );
    expect(bad.issues).toEqual([{ path: 'n', message: '타입 불일치: 출력 string → 입력 number' }]);
    expect(
      checkSchemaCompat(obj({ n: { type: 'integer' } }, ['n']), obj({ n: { type: 'number' } }, ['n']))
        .compatible,
    ).toBe(true);
    expect(
      checkSchemaCompat(
        obj({ n: { type: ['string', 'null'] } }, ['n']),
        obj({ n: { type: 'string' } }, ['n']),
      ).compatible,
    ).toBe(false);
    expect(checkSchemaCompat({ type: 'array' }, { type: 'object' }).issues[0]!.path).toBe('');
  });

  it('enum, 중첩 객체, 배열 items 재귀', () => {
    const enumBad = checkSchemaCompat(
      obj({ v: { type: 'string', enum: ['pass', 'fail', 'skip'] } }, ['v']),
      obj({ v: { type: 'string', enum: ['pass', 'fail'] } }, ['v']),
    );
    expect(enumBad.issues).toEqual([{ path: 'v', message: '입력이 받지 않는 값: skip' }]);
    expect(
      checkSchemaCompat(obj({ v: { type: 'string' } }, ['v']), obj({ v: { enum: ['a'] } }, ['v'])).compatible,
    ).toBe(false);

    const nested = checkSchemaCompat(
      obj({ meta: obj({ owner: { type: 'string' } }, []) }, ['meta']),
      obj({ meta: obj({ owner: { type: 'string' } }, ['owner']) }, ['meta']),
    );
    expect(nested.issues.map((i) => i.path)).toEqual(['meta.owner']);

    const items = checkSchemaCompat(
      obj({ xs: { type: 'array', items: { type: 'number' } } }, ['xs']),
      obj({ xs: { type: 'array', items: { type: 'string' } } }, ['xs']),
    );
    expect(items.issues.map((i) => i.path)).toEqual(['xs[]']);
  });

  it('examples/agents/design-qa: plan → build → critic 모두 호환, 거꾸로는 비호환', () => {
    const p = parsePipelineYaml(
      readFileSync(new URL('../../../examples/agents/design-qa/pipeline.yaml', import.meta.url), 'utf8'),
    );
    const [plan, build, critic] = p.nodes as RoleNode[];
    expect(checkSchemaCompat(plan!.outputSchema, build!.inputSchema).compatible).toBe(true);
    expect(checkSchemaCompat(build!.outputSchema, critic!.inputSchema).compatible).toBe(true);
    expect(checkSchemaCompat(plan!.outputSchema, critic!.inputSchema).compatible).toBe(false);
  });
});
