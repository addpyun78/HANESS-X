// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SettingsWidgetContext } from '../src/settings/form/api.js';
import {
  EnginePicker,
  EngineSettingsWidget,
  FolderPicker,
  ModelPicker,
  SecretKeyInput,
} from '../src/settings/form/custom-widgets.js';
import { SettingsForm } from '../src/settings/form/SettingsForm.js';
import { field, memorySettings } from './settings-form-fixtures.js';

afterEach(cleanup);

const engineF = field({ key: 'judge.engine', widget: 'engine', schema: { type: 'string', default: '' } });
const modelF = field({
  key: 'judge.model',
  widget: 'model',
  engineKey: 'judge.engine',
  schema: { type: 'string', default: '' },
});
const folderF = field({ key: 'project.tempDir', widget: 'folder', schema: { type: 'string', default: '' } });
const secretF = field({
  key: 'tools.braveKey',
  widget: 'secret',
  storage: 'keychain',
  secretAccount: 'brave-search',
  schema: { type: 'string', minLength: 1 },
});

const ENGINES = [
  { id: 'claude-code', displayName: 'Claude Code' },
  { id: 'codex', displayName: 'Codex' },
];

describe('T-101 0A.6 맞춤 위젯: 엔진·모델 선택기', () => {
  it('엔진 목록은 지금 있는 엔진(listEngines), 빈 값 = 자동, 사라진 엔진도 표시', async () => {
    const onCommit = vi.fn();
    const ctx: SettingsWidgetContext = { listEngines: async () => ENGINES };
    render(
      <EnginePicker field={engineF} value="gemini" values={{}} ctx={ctx} inputId="e" onCommit={onCommit} />,
    );
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(4));
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      '자동으로 고르기',
      'Claude Code',
      'Codex',
      'gemini (지금 없음)',
    ]);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'codex' } });
    expect(onCommit).toHaveBeenCalledWith('codex');
  });

  it('모델: 짝 엔진의 모델 목록 제안(listModels — 5번에서 확장), 없으면 직접 입력', async () => {
    const listModels = vi.fn(async (id: string) => (id === 'codex' ? ['gpt-5-codex', 'gpt-5'] : []));
    const onCommit = vi.fn();
    const { rerender, container } = render(
      <ModelPicker
        field={modelF}
        value=""
        values={{ 'judge.engine': 'codex' }}
        ctx={{ listModels }}
        inputId="m"
        onCommit={onCommit}
      />,
    );
    await waitFor(() => expect(container.querySelectorAll('datalist option')).toHaveLength(2));
    expect(screen.getByRole('combobox').getAttribute('list')).toBe('m-models');
    expect(listModels).toHaveBeenCalledWith('codex');
    rerender(
      <ModelPicker
        field={modelF}
        value=""
        values={{ 'judge.engine': '' }}
        ctx={{ listModels }}
        inputId="m"
        onCommit={onCommit}
      />,
    );
    await waitFor(() => expect(container.querySelector('datalist')).toBeNull());
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'my-model' } });
    fireEvent.blur(screen.getByRole('textbox'));
    expect(onCommit).toHaveBeenCalledWith('my-model');
  });
});

describe('T-101 0A.6 맞춤 위젯: 키 입력기 (키체인 저장, 마스킹)', () => {
  it('저장하면 입력 칸은 비우고 가린 값만 보인다, 지우기', async () => {
    const saveSecret = vi.fn(async (_k: string, v: string) => ({ masked: `••••${v.slice(-4)}` }));
    const deleteSecret = vi.fn(async () => ({}));
    let masked: string | null = null;
    const ui = () => (
      <SecretKeyInput
        field={secretF}
        value={null}
        values={{}}
        ctx={{ saveSecret, deleteSecret }}
        inputId="s"
        masked={masked}
        onMasked={(m) => {
          masked = m;
        }}
        onCommit={() => {}}
      />
    );
    const { rerender, container } = render(ui());
    expect(screen.getByTestId('secret-state').textContent).toBe('저장된 키 없음');
    const input = container.querySelector('input[type="password"]') as HTMLInputElement;
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    expect((await screen.findByRole('alert')).textContent).toBe('키를 넣어 주세요.');
    fireEvent.change(input, { target: { value: 'BSA-secret-abcd1234' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '저장' }));
    });
    expect(saveSecret).toHaveBeenCalledWith('tools.braveKey', 'BSA-secret-abcd1234');
    expect(input.value).toBe('');
    rerender(ui());
    expect(screen.getByTestId('secret-state').textContent).toBe('저장됨 ••••1234');
    expect(container.innerHTML).not.toContain('BSA-secret');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '지우기' }));
    });
    expect(deleteSecret).toHaveBeenCalledWith('tools.braveKey');
    expect(masked).toBeNull();
  });

  it('폼 안에서: 실제 저장소 규칙으로 키체인에만 저장되고 설정 파일에는 안 남는다', async () => {
    const m = memorySettings();
    try {
      render(<SettingsForm api={m.api} groups={['tools']} />);
      const row = await screen.findByText('브레이브 검색 키');
      const box = row.closest('[data-setting-key]') as HTMLElement;
      const input = box.querySelector('input[type="password"]') as HTMLInputElement;
      fireEvent.change(input, { target: { value: 'brave-key-1234567890' } });
      await act(async () => {
        fireEvent.click(box.querySelector('[data-action="settings.secret-save"]')!);
      });
      expect(m.secrets.get('brave-search')).toBe('brave-key-1234567890');
      expect(box.textContent).toContain('저장됨 ••••7890');
      expect(m.store.readGlobal()).toEqual({});
    } finally {
      m.dispose();
    }
  });
});

describe('T-101 0A.6 맞춤 위젯: 폴더 선택기 (T-034 재사용)', () => {
  it('[폴더 고르기] → pickFolder 결과 저장, 취소면 그대로, 이미 열려 있으면 쉬운 말', async () => {
    const onCommit = vi.fn();
    const pickFolder = vi
      .fn<NonNullable<SettingsWidgetContext['pickFolder']>>()
      .mockResolvedValueOnce({ cancelled: false, path: 'C:\\work\\temp' })
      .mockResolvedValueOnce({ cancelled: true })
      .mockRejectedValueOnce(Object.assign(new Error('409'), { status: 409 }));
    render(
      <FolderPicker
        field={folderF}
        value={'C:\\old'}
        values={{}}
        ctx={{ pickFolder }}
        inputId="f"
        onCommit={onCommit}
      />,
    );
    const btn = screen.getByRole('button', { name: '폴더 고르기' });
    await act(async () => fireEvent.click(btn));
    expect(pickFolder).toHaveBeenLastCalledWith('C:\\old');
    expect(onCommit).toHaveBeenCalledWith('C:\\work\\temp');
    await act(async () => fireEvent.click(btn));
    expect(onCommit).toHaveBeenCalledTimes(1);
    await act(async () => fireEvent.click(btn));
    expect(screen.getByRole('alert').textContent).toBe('폴더 창이 이미 열려 있어요.');
  });

  it('pickFolder가 없으면 직접 입력만', () => {
    render(<FolderPicker field={folderF} value="" values={{}} ctx={{}} inputId="f" onCommit={() => {}} />);
    expect(screen.queryByRole('button', { name: '폴더 고르기' })).toBeNull();
    expect(screen.getByRole('textbox')).toBeTruthy();
  });

  it('엔진별 묶음: 주입된 엔진 화면을 넣거나 안내 글', () => {
    const f = field({
      key: 'engines',
      widget: 'engine-settings',
      storage: 'engines-file',
      schema: { type: 'object' },
    });
    const { rerender } = render(
      <EngineSettingsWidget field={f} value={{}} values={{}} ctx={{}} inputId="x" onCommit={() => {}} />,
    );
    expect(screen.getByText('엔진 화면에서 엔진마다 바꿀 수 있어요.')).toBeTruthy();
    rerender(
      <EngineSettingsWidget
        field={f}
        value={{}}
        values={{}}
        ctx={{ renderEngineSettings: () => <p>엔진 카드</p> }}
        inputId="x"
        onCommit={() => {}}
      />,
    );
    expect(screen.getByText('엔진 카드')).toBeTruthy();
  });
});
