// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AUTO_NEEDS_WRITE, permissionView, planModeChange } from '../src/composer/run-mode.js';
import { renderComposer } from './composer.helpers.js';
import { checkPlainKorean } from './plain-check.js';

afterEach(cleanup);

const pickMode = (label: string) => {
  fireEvent.click(screen.getByLabelText(/^모드:/));
  fireEvent.click(screen.getByRole('menuitemradio', { name: new RegExp(`^${label}`) }));
};

// T-101 3A.4 모드-권한 연동
describe('3A.4 모드-권한 연동', () => {
  it('순수 함수: 계획이면 읽기 전용 잠금, 오토 + 읽기 전용이면 묻기', () => {
    expect(permissionView('plan', 'full')).toEqual({ permission: 'read-only', locked: true });
    expect(permissionView('normal', 'full')).toEqual({ permission: 'full', locked: false });
    expect(planModeChange('auto', 'read-only')).toMatchObject({
      kind: 'confirm-write',
      upgradeTo: 'workspace-write',
    });
    expect(planModeChange('auto', 'workspace-write')).toEqual({ kind: 'apply', mode: 'auto' });
    expect(checkPlainKorean(AUTO_NEEDS_WRITE).ok).toBe(true);
  });

  it('계획 → 권한 칩이 읽기 전용 + 자물쇠로 고정, 펼쳐지지 않고 전송도 읽기 전용, 풀면 원래 값', () => {
    const { onSend } = renderComposer({ initialSettings: { permission: 'full' } });
    pickMode('계획');
    const chip = screen.getByLabelText('권한: 읽기 전용');
    expect(chip.getAttribute('aria-disabled')).toBe('true');
    expect(chip.textContent).toContain('🔒');
    fireEvent.click(chip);
    expect(screen.queryByRole('menu', { name: '권한' })).toBeNull();

    fireEvent.change(screen.getByLabelText('지시 입력'), { target: { value: '살펴봐' } });
    fireEvent.click(screen.getByLabelText('전송'));
    expect(onSend.mock.calls[0]![0].settings).toMatchObject({ mode: 'plan', permission: 'read-only' });

    pickMode('일반');
    expect(screen.getByLabelText('권한: 전체').getAttribute('aria-disabled')).toBeNull();
  });

  it('오토 + 읽기 전용 → 질문, [바꾸기]면 워크스페이스 쓰기 + 오토', () => {
    const { onSettingsChange } = renderComposer({ initialSettings: { permission: 'read-only' } });
    pickMode('오토');
    const ask = screen.getByRole('alertdialog', { name: '모드 바꾸기 확인' });
    expect(ask.textContent).toContain(AUTO_NEEDS_WRITE);
    expect(screen.getByLabelText('모드: 일반')).toBeTruthy(); // 아직 안 바뀜
    fireEvent.click(screen.getByRole('button', { name: '워크스페이스 쓰기로 바꾸기' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByLabelText('모드: 오토')).toBeTruthy();
    expect(screen.getByLabelText('권한: 워크스페이스 쓰기')).toBeTruthy();
    expect(onSettingsChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ mode: 'auto', permission: 'workspace-write' }),
    );
  });

  it('오토 + 읽기 전용 → [그대로 두기]면 아무것도 안 바뀜', () => {
    renderComposer({ initialSettings: { permission: 'read-only' } });
    pickMode('오토');
    fireEvent.click(screen.getByRole('button', { name: '그대로 두기' }));
    expect(screen.getByLabelText('모드: 일반')).toBeTruthy();
    expect(screen.getByLabelText('권한: 읽기 전용')).toBeTruthy();
  });

  it('오토 + 워크스페이스 쓰기는 묻지 않고 바로', () => {
    renderComposer();
    pickMode('오토');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByLabelText('모드: 오토')).toBeTruthy();
  });
});
