// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataSection, type EngineKeySource } from '../src/settings/sections/DataSection.js';
import { memorySettings } from './settings-form-fixtures.js';
import { keysIn, renderScreen } from './settings-screen-fixtures.js';

/**
 * T-101 6B.11 데이터·보안 탭: 저장된 키 목록(가린 값, 지우기)·기록 보관 기간·첨부 정리 — 키 값 화면 노출 0건
 */

afterEach(cleanup);

const BRAVE = 'BSAabcdefghijklmnopqrstuv123456';
const CODEX = 'sk-proj-ABCDEFGHIJKLMNOPQRSTUV9xyz';

function engineKeys(): EngineKeySource & { keys: Map<string, string> } {
  const keys = new Map([['codex', CODEX]]);
  return {
    keys,
    // 엔진 API(GET /api/engines)도 가린 값만 준다
    list: async () => [...keys].map(([id, v]) => ({ id, label: 'Codex', masked: `••••${v.slice(-4)}` })),
    remove: async (id) => keys.delete(id),
  };
}

/** 화면 어디에도(글자·입력 값·속성) 원래 키가 없는지 */
function exposures(secrets: readonly string[]): string[] {
  const html = document.body.outerHTML;
  const inputs = [...document.querySelectorAll('input')].map((i) => i.value).join('\n');
  return secrets.filter((s) => html.includes(s) || inputs.includes(s) || html.includes(s.slice(0, 8)));
}

describe('6B.11 데이터·보안', () => {
  it('저장된 키 목록은 가린 값만, 키 값 화면 노출 0건 (보관 기간·첨부 정리 항목 포함)', async () => {
    const m = memorySettings();
    m.store.setSecret('tools.braveKey', BRAVE);
    const ek = engineKeys();
    const cleanupFn = vi.fn(async () => ({ ok: true as const, logs: 1, attachments: 4 }));
    await renderScreen({
      m,
      initialTab: 'data',
      sections: { data: <DataSection api={m.api} engineKeys={ek} extras={{ cleanup: cleanupFn }} /> },
    });
    const sec = await screen.findByRole('region', { name: '데이터·보안' });
    expect(keysIn(sec)).toEqual(['data.retentionDays', 'data.attachmentsKeepDays']);
    const list = screen.getByRole('region', { name: '저장된 키' });
    await waitFor(() => expect(within(list).getAllByTestId('secret-masked')).toHaveLength(2));
    expect(
      within(list)
        .getAllByTestId('secret-masked')
        .map((e) => e.textContent),
    ).toEqual(['••••9xyz', '••••3456']);
    expect(list.textContent).toContain('Codex 키');
    expect(list.textContent).toContain('브레이브 검색 키');
    // 도구·설치 탭의 키 입력기도 열어 본다
    fireEvent.click(screen.getByRole('tab', { name: '도구·설치' }));
    await screen.findByRole('region', { name: '도구·설치' });
    expect(exposures([BRAVE, CODEX])).toEqual([]);
    fireEvent.click(screen.getByRole('tab', { name: '데이터·보안' }));
    await screen.findByRole('region', { name: '저장된 키' });
    expect(exposures([BRAVE, CODEX])).toEqual([]);
    m.dispose();
  });

  it('[지우기]는 그 키만 지우고 목록을 다시 읽는다, [지금 정리하기]는 결과를 쉬운 말로', async () => {
    const m = memorySettings();
    m.store.setSecret('tools.braveKey', BRAVE);
    const ek = engineKeys();
    const cleanupFn = vi.fn(async () => ({ ok: true as const, logs: 1, attachments: 4 }));
    await renderScreen({
      m,
      initialTab: 'data',
      sections: { data: <DataSection api={m.api} engineKeys={ek} extras={{ cleanup: cleanupFn }} /> },
    });
    const list = await screen.findByRole('region', { name: '저장된 키' });
    await waitFor(() => expect(within(list).getAllByRole('button', { name: '지우기' })).toHaveLength(2));
    const brave = list.querySelector('[data-secret-id="tools.braveKey"]') as HTMLElement;
    await act(async () => fireEvent.click(within(brave).getByRole('button', { name: '지우기' })));
    await waitFor(() => expect(within(list).getAllByRole('button', { name: '지우기' })).toHaveLength(1));
    expect(m.secrets.has('brave-search')).toBe(false);
    expect(ek.keys.has('codex')).toBe(true);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '지금 정리하기' })));
    expect(cleanupFn).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('region', { name: '기록 정리' }).textContent).toContain(
      '기록 1개, 첨부 4개를 정리했어요.',
    );
    m.dispose();
  });
});
