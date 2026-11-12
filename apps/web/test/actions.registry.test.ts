import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  ACTION_EFFECT_LABEL,
  ACTIONS,
  act,
  actionEffects,
  isActionId,
  registerActionHandler,
  runAction,
  type ActionEffect,
  type ActionId,
  type ActionSpec,
} from '../src/actions/registry.js';
import { checkPlainAll } from './plain-check.js';

describe('T-101 0C.1 액션 레지스트리', () => {
  it('타입: id는 레지스트리 키, 효과 종류는 5가지, act()는 data-action 속성', () => {
    expectTypeOf<ActionEffect>().toEqualTypeOf<'navigate' | 'open' | 'api' | 'state' | 'download'>();
    expectTypeOf<'composer.send'>().toMatchTypeOf<ActionId>();
    expectTypeOf<'nope.not-here'>().not.toMatchTypeOf<ActionId>();
    expectTypeOf(act).parameter(0).toEqualTypeOf<ActionId>();
    expectTypeOf(act('composer.send')).toEqualTypeOf<{ 'data-action': ActionId }>();
    expectTypeOf(ACTIONS['composer.send']).toMatchTypeOf<ActionSpec>();
    // @ts-expect-error — 없는 id는 타입 오류
    expect(() => act('nope.not-here')).not.toThrow();
    expect(act('composer.send')).toEqual({ 'data-action': 'composer.send' });
  });

  it('모든 항목: 설명(쉬운 말)과 기대 효과 종류가 있다, id는 영문 kebab-case', () => {
    const ids = Object.keys(ACTIONS) as ActionId[];
    expect(ids.length).toBeGreaterThan(50);
    for (const id of ids) {
      expect(id).toMatch(/^[a-z]+(-[a-z]+)*\.[a-z]+(-[a-z]+)*$/);
      const spec = ACTIONS[id] as ActionSpec;
      expect(spec.description.length).toBeGreaterThan(3);
      for (const e of actionEffects(id)) expect(Object.keys(ACTION_EFFECT_LABEL)).toContain(e);
    }
    const r = checkPlainAll(ids.map((id) => ACTIONS[id].description));
    expect(r.violations).toEqual([]);
  });

  it('isActionId / 전역 처리 함수 등록·실행·해제', () => {
    expect(isActionId('composer.send')).toBe(true);
    expect(isActionId('nope.not-here')).toBe(false);
    expect(isActionId(null)).toBe(false);
    expect(runAction('nav.settings')).toBe(false);
    const got: unknown[] = [];
    const off = registerActionHandler('nav.settings', (a) => got.push(a));
    expect(runAction('nav.settings', 'x')).toBe(true);
    expect(got).toEqual(['x']);
    off();
    expect(runAction('nav.settings')).toBe(false);
  });
});
