// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { buildEngineCards } from '../src/settings/Engines/model.js';
import { RESPONSE, fakeApi, mount } from './settings-fixtures.js';

afterEach(cleanup);

describe('38.5 다시 스캔 + 미설치 지원 엔진 회색 카드', () => {
  it('미설치 엔진은 회색 카드 + 설치 안내 링크, 다시 스캔하면 새로 발견된 엔진이 일반 카드로 (스냅샷)', async () => {
    const { api, calls } = fakeApi();
    const { container } = await mount(api);
    const agy = screen.getByRole('article', { name: 'Antigravity (미설치)' });
    expect(agy.getAttribute('data-installed')).toBe('false');
    expect(within(agy).getByRole('link', { name: '설치 안내' }).getAttribute('href')).toBe(
      'https://antigravity.google/',
    );
    expect(screen.getByRole('article', { name: 'Gemini CLI (미설치)' })).toBeTruthy();
    expect(
      [...container.querySelectorAll('.hx-engine-card[data-installed="false"]')].map((e) =>
        e.getAttribute('aria-label'),
      ),
    ).toMatchSnapshot('grey-before');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '다시 스캔' })));
    expect(calls).toContainEqual(['rescan']);
    expect(screen.getByRole('article', { name: 'Antigravity' }).getAttribute('data-installed')).toBe('true');
    expect(screen.getByText('2026-11-10 10:00')).toBeTruthy();
    expect(container.querySelector('.hx-engines__grid')!.innerHTML).toMatchSnapshot('after-rescan');
  });

  it('지원 목록 밖 CLI도 카드, 설치된 엔진 먼저', () => {
    const cards = buildEngineCards({
      ...RESPONSE,
      scan: {
        engines: [
          { name: 'opencode', location: 'linux', path: '/bin/opencode', version: null, status: 'unknown' },
        ],
      },
    });
    expect(cards.map((c) => [c.id, c.installed, c.supported])).toEqual([
      ['opencode', true, false],
      ['claude-code', false, true],
      ['codex', false, true],
      ['antigravity', false, true],
      ['gemini', false, true],
    ]);
  });
});
