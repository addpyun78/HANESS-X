// @vitest-environment jsdom
import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineSetting } from '../../../packages/kernel/src/settings/registry.js';
import { memorySettings } from './settings-form-fixtures.js';
import { keysIn, openTab, registryWith, renderScreen } from './settings-screen-fixtures.js';

/**
 * T-101 6B.8 첨부 탭 — 키(attachments.*)는 1번 구역(1A.5)이 레지스트리 attachments 그룹에 등록한다.
 * 이 탭은 그룹 기반이라 등록된 키만으로 그려지고, 등록하면 저절로 나타난다(크기 한도·OCR·동영상 장면 수·비밀 검사).
 */

afterEach(cleanup);

const ATTACH = [
  defineSetting('attachments.maxFileMb', z.number().int().min(1).max(2048).default(100), {
    group: 'attachments',
    title: '파일 하나 크기 한도(MB)',
    description: '이보다 큰 파일은 붙이지 않아요.',
    advanced: false,
    restartRequired: false,
    scope: 'both',
  }),
  defineSetting('attachments.ocr', z.boolean().default(true), {
    group: 'attachments',
    title: '그림 속 글자 읽기',
    description: '그림에 있는 글자를 글로 바꿔서 함께 넘겨요.',
    advanced: false,
    restartRequired: false,
    scope: 'global',
  }),
  defineSetting('attachments.videoFrames', z.number().int().min(1).max(60).default(8), {
    group: 'attachments',
    title: '동영상 장면 수',
    description: '동영상에서 뽑을 장면 수예요.',
    advanced: true,
    restartRequired: false,
    scope: 'global',
  }),
  defineSetting('attachments.secretScan', z.boolean().default(true), {
    group: 'attachments',
    title: '비밀 값 검사',
    description: '붙인 파일에 비밀번호 같은 값이 있는지 먼저 살펴요.',
    advanced: false,
    restartRequired: false,
    scope: 'global',
  }),
];

describe('6B.8 첨부', () => {
  it('지금 레지스트리 키만으로 탭이 그려진다 (등록 전이면 쉬운 말 빈 안내)', async () => {
    const { m } = await renderScreen({ initialTab: 'attachments' });
    const sec = await screen.findByRole('region', { name: '첨부' });
    const keys = keysIn(sec);
    // master에 이미 attachments.* 가 있으면 그 키들이, 없으면 빈 안내가 보인다
    if (keys.length === 0) expect(within(sec).getByText('아직 바꿀 수 있는 설정이 없어요.')).toBeTruthy();
    else expect(keys.every((k) => k.startsWith('attachments.'))).toBe(true);
    m.dispose();
  });

  it('1번 구역이 attachments.* 를 등록하면 저절로 나타난다 (크기 한도·OCR·비밀 검사, 장면 수는 고급, 스냅샷)', async () => {
    const m = memorySettings({ registry: registryWith(...ATTACH) });
    await renderScreen({ m });
    const sec = await openTab('첨부');
    expect(keysIn(sec)).toEqual(
      expect.arrayContaining(['attachments.maxFileMb', 'attachments.ocr', 'attachments.secretScan']),
    );
    expect(sec.querySelector('[data-setting-key="attachments.maxFileMb"]')).toMatchSnapshot();
    m.dispose();
  });
});
