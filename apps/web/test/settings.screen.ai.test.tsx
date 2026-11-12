// @vitest-environment jsdom
// @features F-118
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineSetting } from '../../../packages/kernel/src/settings/registry.js';
import { EnginesSettings } from '../src/settings/Engines/EnginesSettings.js';
import { fakeApi } from './settings-fixtures.js';
import { memorySettings } from './settings-form-fixtures.js';
import { keysIn, openTab, registryWith, renderScreen } from './settings-screen-fixtures.js';

/**
 * T-101 6B.2 AI·엔진 탭: 엔진 카드(T-038 설정 > 엔진 화면을 이리로 옮김) — 구독/API 키, 모델, 폴백,
 * [다시 찾기], [테스트 실행] + 레지스트리의 ai 그룹 항목. 메인 AI(5C, main.engine/main.model)는 5번 구역이
 * 레지스트리에 등록하면 이 탭에 저절로 나타난다.
 */

afterEach(cleanup);

describe('6B.2 AI·엔진', () => {
  it('엔진 카드가 AI·엔진 탭 안에 있고 구독/API·폴백·다시 찾기·테스트 실행이 보인다 (스냅샷)', async () => {
    const eng = fakeApi();
    const { m } = await renderScreen({
      initialTab: 'ai',
      ctx: { renderEngineSettings: () => <EnginesSettings api={eng.api} /> },
    });
    const ai = await screen.findByRole('region', { name: 'AI·엔진' });
    expect(keysIn(ai)).toEqual(expect.arrayContaining(['engines', 'builder.engine']));
    const cards = await within(ai).findByRole('region', { name: '엔진 설정' });
    await act(async () => {});
    const codex = within(cards).getByRole('article', { name: 'Codex' });
    expect(within(codex).getByLabelText('Codex 폴백 엔진')).toBeTruthy();
    expect(within(codex).getByRole('button', { name: '테스트 실행' })).toBeTruthy();
    expect(within(codex).getByRole('radio', { name: '구독' })).toBeTruthy();
    expect(within(codex).getByRole('radio', { name: 'API' })).toHaveProperty('checked', true);
    expect(within(codex).getByLabelText('Codex API 키')).toBeTruthy();
    await act(async () => fireEvent.click(within(cards).getByRole('button', { name: '다시 찾기' })));
    expect(eng.calls).toContainEqual(['rescan']);
    expect(cards).toMatchSnapshot();
    m.dispose();
  });

  it('5번 구역이 main.engine을 ai 그룹에 등록하면 저절로 나타난다 (그룹 기반)', async () => {
    const reg = registryWith(
      defineSetting('main.engine', z.string().default(''), {
        group: 'ai',
        title: '메인 AI',
        description: '새 대화와 하네스 자체 기능이 기본으로 쓰는 AI예요.',
        advanced: false,
        restartRequired: false,
        scope: 'both',
        widget: 'engine',
      }),
    );
    const m = memorySettings({ registry: reg });
    await renderScreen({ m });
    const ai = await openTab('AI·엔진');
    expect(keysIn(ai)).toEqual(expect.arrayContaining(['main.engine', 'engines', 'builder.engine']));
    m.dispose();
  });
});
