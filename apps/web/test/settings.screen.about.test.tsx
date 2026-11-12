// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AboutSection } from '../src/settings/sections/AboutSection.js';
import { renderScreen } from './settings-screen-fixtures.js';

/**
 * T-101 6B.13 정보 탭: 버전·[업데이트 확인]·[진단 파일 내보내기] (키 패턴 0건은 커널 settings.diagnostics.test.ts —
 * 서버가 파일을 만들고 키 모양 글자를 가린다. 화면은 받은 글을 그대로 내려받는다)
 */

afterEach(cleanup);

describe('6B.13 정보', () => {
  it('버전 표시, 업데이트 확인 결과, 진단 파일 내려받기 (스냅샷)', async () => {
    const download = vi.fn();
    const extras = {
      about: async () => ({ version: '1.2.3', platform: 'win32', node: 'v22.23.4', updateCheck: false }),
      updateCheck: async () => ({ current: '1.2.3', message: '지금 최신 버전이에요.' }),
      diagnostics: async () => ({
        file: 'harness-x-diagnostics.json',
        text: '{"kind":"harness-x-diagnostics"}\n',
      }),
    };
    const { m } = await renderScreen({
      initialTab: 'about',
      sections: { about: <AboutSection extras={extras} download={download} /> },
    });
    const card = await screen.findByRole('region', { name: '하네스 정보' });
    expect((await screen.findByTestId('about-version')).textContent).toBe('1.2.3');
    expect(card).toMatchSnapshot();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '업데이트 확인' })));
    expect(card.textContent).toContain('지금 최신 버전이에요.');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '진단 파일 내보내기' })));
    expect(download).toHaveBeenCalledWith('harness-x-diagnostics.json', '{"kind":"harness-x-diagnostics"}\n');
    expect(card.textContent).toContain('진단 파일을 내려받았어요. 키와 첨부 내용은 들어 있지 않아요.');
    m.dispose();
  });
});
