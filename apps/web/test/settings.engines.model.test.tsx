// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { fakeApi, mount } from './settings-fixtures.js';

afterEach(cleanup);

describe('38.3 기본 모델·폴백 엔진', () => {
  it('저장 → PUT settings {model, fallback} (설정 파일 반영은 커널 api.engines.test)', async () => {
    const { api, calls } = fakeApi();
    await mount(api);
    const codex = screen.getByRole('article', { name: 'Codex' });
    const model = within(codex).getByLabelText('Codex 기본 모델') as HTMLInputElement;
    expect(model.value).toBe('gpt-5-codex');
    const fb = within(codex).getByLabelText('Codex 폴백 엔진') as HTMLSelectElement;
    expect(fb.value).toBe('claude-code');
    expect([...fb.options].map((o) => o.value)).toEqual(['', 'claude-code']); // 자기 자신 제외, 설치된 엔진만
    fireEvent.change(model, { target: { value: 'gpt-5' } });
    fireEvent.change(fb, { target: { value: '' } });
    await act(async () => fireEvent.click(within(codex).getByRole('button', { name: '저장' })));
    expect(calls).toContainEqual(['settings', 'codex', { model: 'gpt-5', fallback: [] }]);
  });
});
