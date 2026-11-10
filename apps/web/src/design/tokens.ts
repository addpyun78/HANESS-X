import raw from './tokens.json' with { type: 'json' };

/** 디자인 토큰 — 모든 색·간격·반경·글자 크기의 단일 출처 (apps/web/src/design/tokens.json) */

export const NEUTRAL_STEPS = ['100', '200', '300', '400', '500', '600', '700', '800', '900'] as const;
export const STATUS_NAMES = ['success', 'warning', 'danger', 'info', 'running', 'paused'] as const;
export const SPACE_SCALE = [4, 8, 12, 16, 24, 32] as const;
export const FONT_SIZES = [12, 13, 14, 16, 20] as const;
export const RADIUS = 8;

export type NeutralStep = (typeof NEUTRAL_STEPS)[number];
export type StatusName = (typeof STATUS_NAMES)[number];

export interface DesignTokens {
  color: {
    neutral: Record<NeutralStep, string>;
    accent: string;
    status: Record<StatusName, string>;
  };
  space: number[];
  radius: number;
  font: { size: number[]; family: { body: string; mono: string } };
}

export const tokens: DesignTokens = raw as DesignTokens;
