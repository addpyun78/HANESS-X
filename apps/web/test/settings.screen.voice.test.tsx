// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { keysIn, renderScreen } from './settings-screen-fixtures.js';

/** T-101 6B.9 음성 탭: 받아쓰기 방식(내 컴퓨터에서 / 브라우저 기능 / 끄기) — 이 기기 화면에만 */

afterEach(cleanup);

describe('6B.9 음성', () => {
  it('받아쓰기 방식 3가지, 고르면 음성 입력이 읽는 저장 이름(hx.stt.provider)에 남는다 (스냅샷)', async () => {
    const { m, storage } = await renderScreen({ initialTab: 'voice' });
    const sec = await screen.findByRole('region', { name: '음성' });
    expect(keysIn(sec)).toEqual(['voice.provider']);
    const sel = within(sec).getByLabelText('말로 입력하는 방법');
    expect([...sel.querySelectorAll('option')].map((o) => o.textContent)).toEqual([
      '내 컴퓨터에서',
      '브라우저 기능',
      '끄기',
    ]);
    expect(sec).toMatchSnapshot();
    fireEvent.change(sel, { target: { value: 'browser' } });
    expect(storage.map.get('hx.stt.provider')).toBe('browser');
    m.dispose();
  });
});
