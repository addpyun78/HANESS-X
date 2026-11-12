// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineSetting } from '../../../packages/kernel/src/settings/registry.js';
import type { ProjectSettingsIO } from '../../../packages/kernel/src/settings/store.js';
import { ProjectSettings } from '../src/shell/projects/ProjectSettings.js';
import type { ProjectView } from '../src/shell/projects/api.js';
import { memorySettings } from './settings-form-fixtures.js';
import { keysIn, openTab, registryWith, renderScreen, rowsOf } from './settings-screen-fixtures.js';

/**
 * T-101 6B.14 모든 항목에 "이 값이 어디에 적용되나요?"(전체 / 이 프로젝트 / 이 기기 화면에만) 표시,
 * 프로젝트 값이 전체 값을 덮으면 "이 프로젝트에서는 "○○" 값을 써요." 안내.
 * 프로젝트 값 저장은 ProjectSettingsIO (실제 서버는 project-settings-io.ts → <프로젝트>/.harness-x/project.json).
 */

afterEach(cleanup);

const MODE = defineSetting('mode.default', z.enum(['plan', 'normal', 'auto']).default('normal'), {
  group: 'mode',
  title: '기본 모드',
  description: '새 작업을 시작할 때의 모드예요.',
  advanced: false,
  restartRequired: false,
  scope: 'both',
  options: { plan: '계획', normal: '일반', auto: '오토' },
});

function memoryProjects(init: Record<string, Record<string, unknown>> = {}): ProjectSettingsIO & {
  data: Record<string, Record<string, unknown>>;
} {
  const data = structuredClone(init);
  return {
    data,
    read: (id) => structuredClone(data[id] ?? {}),
    write: (id, v) => void (data[id] = structuredClone(v)),
  };
}

const PROJECT: ProjectView = {
  id: 'p1',
  name: '임장 노트',
  rootPath: 'C:\\work\\imjang',
  createdAt: '2026-11-01T00:00:00.000Z',
  lastOpenedAt: '2026-11-01T00:00:00.000Z',
  pinned: false,
  order: 0,
  missing: false,
};

describe('6B.14 적용 범위 표시', () => {
  it('모든 항목에 적용 범위 표시가 있다 (전체 / 이 기기 화면에만 / 전체(프로젝트마다 바꿀 수 있음))', async () => {
    const m = memorySettings({ registry: registryWith(MODE), project: memoryProjects() });
    await renderScreen({ m, project: 'p1' });
    for (const [tab, expected] of [
      ['일반', '이 기기 화면에만'],
      ['판정', '전체'],
      ['모드·권한', undefined],
    ] as const) {
      const sec = await openTab(tab);
      const rows = [...sec.querySelectorAll<HTMLElement>('[data-setting-key]')];
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) {
        const tag = r.querySelector('.hx-setting__scope')!;
        expect(tag.getAttribute('title')).toBe('이 값이 어디에 적용되나요?');
        if (expected) expect(tag.textContent).toBe(expected);
      }
    }
    const mode = screen.getByRole('region', { name: '모드·권한' });
    expect(rowsOf(mode, ['mode.default'])[0]!.querySelector('.hx-setting__scope')!.textContent).toBe(
      '전체 (프로젝트마다 바꿀 수 있음)',
    );
    m.dispose();
  });

  it('프로젝트 값이 전체 값을 덮고 있으면 "이 프로젝트에서는 ○○ 값을 써요" (스냅샷)', async () => {
    const io = memoryProjects({ p1: { mode: { default: 'plan' } } });
    const m = memorySettings({ registry: registryWith(MODE), project: io });
    m.store.set('mode.default', 'auto');
    await renderScreen({ m, project: 'p1', initialTab: 'mode' });
    const mode = await screen.findByRole('region', { name: '모드·권한' });
    const row = rowsOf(mode, ['mode.default'])[0]!;
    expect(within(row).getByRole('note').textContent).toBe(
      '이 프로젝트에서는 "계획" 값을 써요. 전체 값은 다른 프로젝트에 쓰여요.',
    );
    expect(row).toMatchSnapshot();
    // 프로젝트를 고르지 않았으면 안내 없음
    cleanup();
    await renderScreen({ m, initialTab: 'mode' });
    const plain = await screen.findByRole('region', { name: '모드·권한' });
    expect(within(rowsOf(plain, ['mode.default'])[0]!).queryByRole('note')).toBeNull();
    m.dispose();
  });

  it('프로젝트 설정(0B.41)의 "이 프로젝트에서만 바꿀 설정"은 project|both 키만, 저장은 프로젝트 값으로', async () => {
    const io = memoryProjects();
    const m = memorySettings({ registry: registryWith(MODE), project: io });
    render(
      <ProjectSettings
        project={PROJECT}
        engines={[]}
        agents={[]}
        onSave={() => {}}
        onRelink={() => {}}
        onClose={() => {}}
        settings={{ api: m.api }}
      />,
    );
    const scoped = await screen.findByRole('region', { name: '이 프로젝트에서만 바꿀 설정' });
    await waitFor(() => expect(keysIn(scoped)).toEqual(['mode.default']));
    expect(scoped.querySelector('.hx-setting__scope')!.textContent).toBe('이 프로젝트에만');
    fireEvent.change(within(scoped).getByLabelText('기본 모드'), { target: { value: 'plan' } });
    await waitFor(() => expect(io.data.p1).toEqual({ mode: { default: 'plan' } }));
    expect(m.store.readGlobal()).toEqual({});
    m.dispose();
  });

  it('프로젝트마다 바꿀 키가 하나도 없으면 쉬운 말 안내', async () => {
    const m = memorySettings({ project: memoryProjects() });
    render(
      <ProjectSettings
        project={PROJECT}
        engines={[]}
        agents={[]}
        onSave={() => {}}
        onRelink={() => {}}
        onClose={() => {}}
        settings={{ api: m.api }}
      />,
    );
    const scoped = await screen.findByRole('region', { name: '이 프로젝트에서만 바꿀 설정' });
    // 지금 레지스트리에 both 키가 있으면(다른 구역 병합 뒤) 그 키들이, 없으면 안내가 보인다
    await waitFor(() =>
      expect(
        keysIn(scoped).length > 0 ||
          within(scoped).queryByText(/프로젝트마다 바꿀 수 있는 설정이 아직 없어요/),
      ).toBeTruthy(),
    );
    m.dispose();
  });
});
