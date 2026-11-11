import { describe, expect, expectTypeOf, it } from 'vitest';
import { AcceptanceSchema, CompareSpecSchema, parseItem, type CompareSpec } from '../src/schema.js';
import { item } from './helpers.js';

describe('T-100 D.1 acceptance.compare { kind, options?, semantic?: auto|off }', () => {
  it('기계 검증 조건 5종에 compare를 붙일 수 있다', () => {
    const compare = { kind: 'text', options: { mode: 'contains' }, semantic: 'off' } as const;
    for (const a of [
      { type: 'command', run: 'hx --version', expectOutput: 'v1.2', compare: { kind: 'version' } },
      { type: 'test', run: 'pnpm test', compare: { kind: 'exitCode' } },
      { type: 'file_exists', compare: { kind: 'path', semantic: 'auto' } },
      { type: 'symbol', symbol: 'LoginScreen', compare },
      {
        type: 'schema',
        requiredKeys: ['name'],
        compare: { kind: 'json', options: { ignoreKeys: ['time'] } },
      },
    ])
      expect(AcceptanceSchema.parse(a)).toMatchObject(a);
    const parsed = parseItem(item('1', { acceptance: [{ type: 'symbol', symbol: 'X', compare }] }));
    expect(parsed.acceptance[0]).toEqual({ type: 'symbol', symbol: 'X', compare });
    expectTypeOf<CompareSpec['semantic']>().toEqualTypeOf<'auto' | 'off' | undefined>();
  });

  it('compare 없는 기존 조건은 그대로 통과 (선택 필드)', () => {
    expect(AcceptanceSchema.parse({ type: 'test', run: 'pnpm test' })).toEqual({
      type: 'test',
      run: 'pnpm test',
      expectExit: 0,
    });
  });

  it('잘못된 kind·semantic·추가 키 거부', () => {
    expect(CompareSpecSchema.safeParse({ kind: '' }).success).toBe(false);
    expect(CompareSpecSchema.safeParse({ kind: '9x' }).success).toBe(false);
    expect(CompareSpecSchema.safeParse({ kind: 'text', semantic: 'maybe' }).success).toBe(false);
    expect(CompareSpecSchema.safeParse({ kind: 'text', strict: true }).success).toBe(false);
    expect(CompareSpecSchema.safeParse({ kind: 'text', options: 'x' }).success).toBe(false);
    expect(AcceptanceSchema.safeParse({ type: 'test', run: 'x', compare: { semantic: 'off' } }).success).toBe(
      false,
    );
  });
});
