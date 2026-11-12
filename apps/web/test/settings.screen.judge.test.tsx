// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { keysIn, renderScreen, titlesIn } from './settings-screen-fixtures.js';

/** T-101 6B.5 판정 탭: 판정에 쓸 AI(judge.engine)·뜻으로 판정하기 + (고급) 여러 번 물어보기·작업 한 번의 판정 한도 */

afterEach(cleanup);

const ENGINES = [
  { id: 'claude-code', displayName: 'Claude Code' },
  { id: 'codex', displayName: 'Codex' },
];

describe('6B.5 판정', () => {
  it('기본: 판정 AI·뜻으로 판정하기 / 고급: 반복 횟수·호출 한도 (스냅샷)', async () => {
    const { m } = await renderScreen({ initialTab: 'judge', ctx: { listEngines: async () => ENGINES } });
    const judge = await screen.findByRole('region', { name: '판정' });
    expect(keysIn(judge)).toEqual(['judge.engine', 'judge.semantic']);
    await within(judge).findByRole('option', { name: 'Codex' });
    expect(judge).toMatchSnapshot();
    fireEvent.click(screen.getByRole('checkbox', { name: '고급 설정 보기' }));
    const adv = await screen.findByRole('region', { name: '판정' });
    await waitFor(() => expect(keysIn(adv)).toContain('judge.samples'));
    expect(titlesIn(adv)).toEqual(
      expect.arrayContaining([
        '판정할 때 쓸 AI',
        '뜻으로 판정하기',
        '여러 번 물어보기',
        '작업 한 번의 판정 한도',
      ]),
    );
    m.dispose();
  });

  it('판정 AI를 고르면 저장되고 "다시 시작하면 적용돼요"', async () => {
    const { m } = await renderScreen({ initialTab: 'judge', ctx: { listEngines: async () => ENGINES } });
    const judge = await screen.findByRole('region', { name: '판정' });
    await within(judge).findByRole('option', { name: 'Codex' });
    fireEvent.change(within(judge).getByLabelText('판정할 때 쓸 AI'), { target: { value: 'codex' } });
    expect((await within(judge).findByRole('status')).textContent).toBe('다시 시작하면 적용돼요.');
    expect(m.store.readGlobal()).toEqual({ judge: { engine: 'codex' } });
    m.dispose();
  });
});
