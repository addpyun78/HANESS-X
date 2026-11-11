// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SettingsForm } from '../src/settings/form/SettingsForm.js';
import { checkPlainKorean } from './plain-check.js';
import { memorySettings, memoryStorage, type MemorySettings } from './settings-form-fixtures.js';

let m: MemorySettings | undefined;
afterEach(() => {
  cleanup();
  m?.dispose();
  m = undefined;
});

const row = (key: string) => document.querySelector(`[data-setting-key="${key}"]`) as HTMLElement;

async function setNumber(key: string, v: string) {
  const input = within(row(key)).getByRole('spinbutton');
  fireEvent.change(input, { target: { value: v } });
  await act(async () => {
    fireEvent.blur(input);
  });
}

describe('T-101 0A.7 저장 즉시 적용 · 다시 시작 안내 · 쉬운 말 오류', () => {
  it('잘못된 값 저장 거부: 쉬운 말 오류, 저장 파일은 그대로', async () => {
    m = memorySettings();
    render(<SettingsForm api={m.api} groups={['judge']} showAdvanced />);
    await screen.findByText('여러 번 물어보기');
    await setNumber('judge.samples', '9');
    const alert = await within(row('judge.samples')).findByRole('alert');
    expect(alert.textContent).toBe('3 이하로 넣어 주세요.');
    expect(checkPlainKorean(alert.textContent!).ok).toBe(true);
    expect(m.store.readGlobal()).toEqual({});
    await setNumber('judge.samples', '');
    expect((await within(row('judge.samples')).findByText('숫자를 넣어 주세요.')).getAttribute('role')).toBe(
      'alert',
    );
    expect(m.store.readGlobal()).toEqual({});
  });

  it('올바른 값은 바로 저장, restartRequired 항목은 "다시 시작하면 적용돼요."', async () => {
    m = memorySettings();
    render(<SettingsForm api={m.api} groups={['judge', 'ai']} showAdvanced />);
    await screen.findByText('여러 번 물어보기');
    expect(within(row('judge.samples')).getByText('다시 시작 필요')).toBeTruthy();
    await setNumber('judge.samples', '2');
    expect(m.store.readGlobal()).toEqual({ judge: { samples: 2 } });
    expect((await within(row('judge.samples')).findByRole('status')).textContent).toBe(
      '다시 시작하면 적용돼요.',
    );
    // 다시 시작이 필요 없는 항목
    await act(async () => {
      fireEvent.click(within(row('builder.animation')).getByRole('switch'));
    });
    expect(m.store.readGlobal()).toMatchObject({ builder: { animation: false } });
    expect((await within(row('builder.animation')).findByRole('status')).textContent).toBe('저장했어요.');
    expect(within(row('builder.animation')).queryByText('다시 시작 필요')).toBeNull();
  });

  it('구독자가 저장 즉시 바뀐 값을 받는다 (즉시 적용)', async () => {
    m = memorySettings();
    const seen: unknown[] = [];
    m.store.subscribe((c) => seen.push(...c));
    render(<SettingsForm api={m.api} groups={['tools']} />);
    await screen.findByText('도구 비용 기준');
    await act(async () => {
      fireEvent.change(within(row('tools.budget')).getByRole('combobox'), { target: { value: 'free-only' } });
    });
    expect(seen).toEqual([{ key: 'tools.budget', scope: 'global', value: 'free-only' }]);
  });

  it('브라우저 저장 항목(테마)은 이 기기 저장소에 바로 저장', async () => {
    m = memorySettings();
    const storage = memoryStorage();
    render(<SettingsForm api={m.api} groups={['general']} storage={storage} onBrowserChange={() => {}} />);
    await screen.findByText('화면 테마');
    fireEvent.change(within(row('ui.theme')).getByRole('combobox'), { target: { value: 'dark' } });
    expect(storage.map.get('hx-theme')).toBe('dark');
    expect(m.api.calls).toEqual([]);
  });
});

describe('T-101 0A.8 되돌리기 3단계', () => {
  async function seeded() {
    m = memorySettings();
    m.store.set('judge.samples', 1);
    m.store.set('judge.semantic', 'off');
    m.store.set('tools.budget', 'any');
    const storage = memoryStorage({ 'hx-theme': 'dark' });
    render(<SettingsForm api={m.api} showAdvanced storage={storage} onBrowserChange={() => {}} />);
    await screen.findByText('여러 번 물어보기');
    return storage;
  }

  it('항목 하나: [기본값으로]는 바뀐 항목에만 보이고, 누르면 그 항목만 기본값', async () => {
    await seeded();
    expect(within(row('judge.model')).queryByRole('button', { name: '기본값으로' })).toBeNull();
    await act(async () => {
      fireEvent.click(within(row('judge.samples')).getByRole('button', { name: '기본값으로' }));
    });
    await waitFor(() =>
      expect((within(row('judge.samples')).getByRole('spinbutton') as HTMLInputElement).value).toBe('3'),
    );
    expect(m!.store.effective()).toMatchObject({
      'judge.samples': 3,
      'judge.semantic': 'off',
      'tools.budget': 'any',
    });
  });

  it('섹션: [이 묶음 기본값으로]는 그 그룹만', async () => {
    await seeded();
    const sec = document.querySelector('[data-setting-group="judge"]') as HTMLElement;
    await act(async () => {
      fireEvent.click(within(sec).getByRole('button', { name: '이 묶음 기본값으로' }));
    });
    expect(m!.store.effective()).toMatchObject({
      'judge.samples': 3,
      'judge.semantic': 'on',
      'tools.budget': 'any',
    });
    await waitFor(() =>
      expect((within(row('judge.semantic')).getByRole('combobox') as HTMLSelectElement).value).toBe('on'),
    );
  });

  it('전체: 한 번 더 묻고 되돌린다 (브라우저 저장 항목 포함)', async () => {
    const storage = await seeded();
    fireEvent.click(screen.getByRole('button', { name: '모든 설정 기본값으로' }));
    fireEvent.click(screen.getByRole('button', { name: '그만두기' }));
    expect(m!.store.readGlobal()).not.toEqual({});
    fireEvent.click(screen.getByRole('button', { name: '모든 설정 기본값으로' }));
    expect(screen.getByRole('group', { name: '모두 되돌리기 확인' }).textContent).toContain(
      '모든 설정을 기본값으로 되돌릴까요?',
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '되돌리기' }));
    });
    expect(m!.store.readGlobal()).toEqual({});
    expect(storage.map.has('hx-theme')).toBe(false);
    await waitFor(() => {
      expect((within(row('ui.theme')).getByRole('combobox') as HTMLSelectElement).value).toBe('system');
      expect((within(row('tools.budget')).getByRole('combobox') as HTMLSelectElement).value).toBe(
        'free-first',
      );
    });
  });
});
