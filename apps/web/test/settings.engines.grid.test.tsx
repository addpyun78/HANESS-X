// @vitest-environment jsdom
import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { locationLabel } from '../src/settings/Engines/model.js';
import { fakeApi, mount } from './settings-fixtures.js';

afterEach(cleanup);

describe('38.1 엔진 카드 그리드', () => {
  it('이름·버전·위치(Windows/WSL)·로그인 배지 (스냅샷)', async () => {
    const { api } = fakeApi();
    const { container } = await mount(api);
    const claude = screen.getByRole('article', { name: 'Claude Code' });
    expect(within(claude).getByText('v2.1.3')).toBeTruthy();
    expect(within(claude).getByText('WSL (Ubuntu)')).toBeTruthy();
    expect(within(claude).getByText('Windows')).toBeTruthy();
    expect(within(claude).getByText('업데이트 필요')).toBeTruthy();
    expect(within(claude).getByTestId('login-badge').textContent).toBe('로그인 확인 불가');
    const codex = screen.getByRole('article', { name: 'Codex' });
    expect(within(codex).getByTestId('login-badge').textContent).toBe('로그인됨');
    expect(locationLabel('macos')).toBe('macOS');
    expect(container.querySelector('.hx-engines__grid')!.innerHTML).toMatchSnapshot();
  });
});
