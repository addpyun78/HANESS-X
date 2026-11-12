// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineSetting } from '../../../packages/kernel/src/settings/registry.js';
import { memorySettings } from './settings-form-fixtures.js';
import { keysIn, openTab, registryWith, renderScreen, rowsOf } from './settings-screen-fixtures.js';

/**
 * T-101 6B.3 모드·권한 탭: 기본 허락 범위(permission.default — 이 구역이 등록, 새 세션 기본값에 연결).
 * 기본 모드(mode.default)·오토 상한(시간·비용·반복)은 3번 구역이 mode 그룹에 등록하면 이 탭에 저절로 나타난다.
 */

afterEach(cleanup);

describe('6B.3 모드·권한', () => {
  it('기본 허락 범위가 보이고 바꾸면 settings.json에 저장된다 (스냅샷)', async () => {
    const { m } = await renderScreen({ initialTab: 'mode' });
    const mode = await screen.findByRole('region', { name: '모드·권한' });
    expect(keysIn(mode)).toContain('permission.default');
    expect(rowsOf(mode, ['permission.default'])).toMatchSnapshot();
    fireEvent.change(within(mode).getByLabelText('기본 허락 범위'), { target: { value: 'read-only' } });
    await waitFor(() => expect(m.store.readGlobal()).toEqual({ permission: { default: 'read-only' } }));
    m.dispose();
  });

  it('3번 구역이 mode.default·오토 상한을 mode 그룹에 등록하면 그대로 나타난다 (그룹 기반)', async () => {
    const reg = registryWith(
      defineSetting('mode.default', z.enum(['plan', 'normal', 'auto']).default('normal'), {
        group: 'mode',
        title: '기본 모드',
        description: '새 작업을 시작할 때의 모드예요.',
        advanced: false,
        restartRequired: false,
        scope: 'both',
        options: { plan: '계획', normal: '일반', auto: '오토' },
      }),
      defineSetting('mode.auto.maxMinutes', z.number().int().min(1).default(60), {
        group: 'mode',
        title: '오토 모드 시간 한도(분)',
        description: '오토 모드가 이 시간을 넘으면 멈춰요.',
        advanced: false,
        restartRequired: false,
        scope: 'global',
      }),
    );
    const m = memorySettings({ registry: reg });
    await renderScreen({ m });
    const mode = await openTab('모드·권한');
    expect(keysIn(mode)).toEqual(
      expect.arrayContaining(['permission.default', 'mode.default', 'mode.auto.maxMinutes']),
    );
    m.dispose();
  });
});
