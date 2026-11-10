import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import raw from '../src/design/tokens.json' with { type: 'json' };
import { FONT_SIZES, NEUTRAL_STEPS, RADIUS, SPACE_SCALE, STATUS_NAMES } from '../src/design/tokens.js';

const hex = z.string().regex(/^#[0-9a-f]{6}$/i);

const TokensSchema = z.strictObject({
  color: z.strictObject({
    neutral: z.strictObject(Object.fromEntries(NEUTRAL_STEPS.map((s) => [s, hex]))),
    accent: hex,
    status: z.strictObject(Object.fromEntries(STATUS_NAMES.map((s) => [s, hex]))),
  }),
  space: z.tuple(SPACE_SCALE.map((n) => z.literal(n)) as [z.ZodLiteral<4>, ...z.ZodLiteral<number>[]]),
  radius: z.literal(RADIUS),
  font: z.strictObject({
    size: z.tuple(FONT_SIZES.map((n) => z.literal(n)) as [z.ZodLiteral<12>, ...z.ZodLiteral<number>[]]),
    family: z.strictObject({
      body: z.string().includes('Pretendard'),
      mono: z.string().includes('JetBrains Mono'),
    }),
  }),
});

describe('tokens.json 스키마', () => {
  it('색(중성 9단계·강조 1색·상태 6색), 간격 4/8/12/16/24/32, 반경 8, 글자 12/13/14/16/20', () => {
    const r = TokensSchema.safeParse(raw);
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
    expect(Object.keys(raw.color.neutral)).toHaveLength(9);
    expect(Object.keys(raw.color.status)).toHaveLength(6);
    expect(raw.space).toEqual([4, 8, 12, 16, 24, 32]);
    expect(raw.font.size).toEqual([12, 13, 14, 16, 20]);
  });

  it('잘못된 토큰은 거부', () => {
    const bad = structuredClone(raw) as Record<string, unknown> & typeof raw;
    (bad.color.neutral as Record<string, string>)['100'] = 'red';
    expect(TokensSchema.safeParse(bad).success).toBe(false);
    expect(TokensSchema.safeParse({ ...raw, radius: 6 }).success).toBe(false);
    expect(TokensSchema.safeParse({ ...raw, space: [4, 8] }).success).toBe(false);
  });
});
