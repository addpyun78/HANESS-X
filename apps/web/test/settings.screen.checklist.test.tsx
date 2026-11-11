// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineSetting } from '../../../packages/kernel/src/settings/registry.js';
import { memorySettings } from './settings-form-fixtures.js';
import { keysIn, openTab, registryWith, renderScreen, rowsOf } from './settings-screen-fixtures.js';

/**
 * T-101 6B.4 체크리스트 탭: 엄격하게 확인하기·정체 감지 기준(방법 바꾸기/멈추기)·(고급) 최대 횟수.
 * 단계 확정 정책(4B.3)은 4번 구역이 checklist 그룹에 등록하면 이 탭에 저절로 나타난다.
 */

afterEach(cleanup);

describe('6B.4 체크리스트', () => {
  it('엄격 모드·정체 감지 기준이 보이고 최대 횟수는 고급 (스냅샷)', async () => {
    const { m } = await renderScreen({ initialTab: 'checklist' });
    const cl = await screen.findByRole('region', { name: '체크리스트' });
    const mine = ['checklist.strict', 'checklist.stallChangeTurns', 'checklist.stallBlockTurns'];
    expect(keysIn(cl)).toEqual(expect.arrayContaining(mine));
    expect(keysIn(cl)).not.toContain('checklist.maxAutoTurns');
    expect(rowsOf(cl, mine)).toMatchSnapshot();
    fireEvent.click(within(rowsOf(cl, ['checklist.strict'])[0]!).getByRole('switch'));
    await waitFor(() => expect(m.store.readGlobal()).toEqual({ checklist: { strict: true } }));
    fireEvent.click(screen.getByRole('checkbox', { name: '고급 설정 보기' }));
    const adv = await screen.findByRole('region', { name: '체크리스트' });
    await waitFor(() => expect(keysIn(adv)).toContain('checklist.maxAutoTurns'));
    m.dispose();
  });

  it('잘못된 값(멈추기 1번)은 쉬운 말로 거부', async () => {
    const { m } = await renderScreen({ initialTab: 'checklist' });
    const cl = await screen.findByRole('region', { name: '체크리스트' });
    const input = within(cl).getByLabelText('멈추고 확인을 부탁할 때');
    fireEvent.change(input, { target: { value: '1' } });
    fireEvent.blur(input);
    expect((await within(cl).findByRole('alert')).textContent).toBe('2 이상으로 넣어 주세요.');
    expect(m.store.readGlobal()).toEqual({});
    m.dispose();
  });

  it('4번 구역이 단계 확정 정책을 checklist 그룹에 등록하면 그대로 나타난다 (그룹 기반)', async () => {
    const m = memorySettings({
      registry: registryWith(
        defineSetting('checklist.stepLock', z.enum(['ask', 'auto']).default('ask'), {
          group: 'checklist',
          title: '단계 확정 방법',
          description: '다음 단계를 확정할 때 물어볼지 정해요.',
          advanced: false,
          restartRequired: false,
          scope: 'both',
          options: { ask: '물어보기', auto: '알아서' },
        }),
      ),
    });
    await renderScreen({ m });
    expect(keysIn(await openTab('체크리스트'))).toContain('checklist.stepLock');
    m.dispose();
  });
});
