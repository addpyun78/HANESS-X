// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PickerCandidateData, ToolNeedData } from '../src/panels/ToolPicker/model.js';
import { fakeDesignerApi, sampleDraft, startChatAndSend } from './draft-fixtures.js';
import { mockReactFlowDom } from './flow-mock.js';
import { fixturePlan } from './install-fixtures.js';
import { pickerData } from './toolpicker-fixtures.js';

beforeAll(mockReactFlowDom);
afterEach(cleanup);

const draftResponse = () => ({
  kind: 'draft' as const,
  draftId: '',
  version: 1,
  draft: sampleDraft(),
  notices: [],
  engineSuggestions: [],
});

describe('P3-C.4 보강: 빌더 빈 칸 도구 고르기 카드 [선택한 걸로 설치] → Part 2 계획 카드', () => {
  it('2개 고르면 계획 카드 2장이 고른 순서대로, 실행은 카드의 [설치] 클릭으로만', async () => {
    const d = pickerData();
    const find = vi.fn(async () => ({
      status: 'candidates' as const,
      need: d.need,
      candidates: d.candidates,
      notices: [],
    }));
    const planSelected = vi.fn(async (_n: ToolNeedData, cs: PickerCandidateData[]) => ({
      // 서버가 순서를 바꿔 돌려줘도 화면은 고른 순서대로
      plans: [...cs].reverse().map((c) => ({
        candidateId: c.id,
        plan: fixturePlan({ id: `plan_${c.id}`, name: c.name }),
      })),
    }));
    const execute = vi.fn(async () => ({
      id: 'job-1',
      planId: 'plan_ffmpeg',
      action: 'install',
      status: 'running',
    }));
    const api = fakeDesignerApi({ design: [draftResponse()] });
    await startChatAndSend(api, undefined, {
      toolPicker: { find, planSelected },
      install: { execute } as never,
    });
    fireEvent.click(screen.getByText('도구 찾기'));
    const picker = await screen.findByLabelText('도구 고르기');
    // 처음엔 추천(ffmpeg)만 골라져 있다 → HandBrake도 고른다
    const boxes = within(picker).getAllByRole('checkbox') as HTMLInputElement[];
    const hb = boxes.find((b) => !b.checked && b.closest('li')?.textContent?.includes('HandBrake'))!;
    fireEvent.click(hb);
    fireEvent.click(within(picker).getByRole('button', { name: /선택한 걸로 설치/ }));

    await vi.waitFor(() => expect(picker.querySelectorAll('[data-card-id^="plan_"]')).toHaveLength(2));
    expect(planSelected).toHaveBeenCalledTimes(1);
    expect(planSelected.mock.calls[0]![1].map((c) => c.id)).toEqual(['ffmpeg', 'handbrake']);
    const ids = [...picker.querySelectorAll('[data-card-id^="plan_"]')].map((e) =>
      e.getAttribute('data-card-id'),
    );
    expect(ids).toEqual(['plan_ffmpeg', 'plan_handbrake']);
    // 도구 고르기 카드는 닫히고, 아직 아무것도 실행하지 않았다
    expect(picker.querySelector('[data-card-id^="tool-picker-"]')).toBeNull();
    expect(execute).not.toHaveBeenCalled();
    const first = picker.querySelector('[data-card-id="plan_ffmpeg"]') as HTMLElement;
    fireEvent.click(within(first).getByRole('button', { name: '설치' }));
    await vi.waitFor(() => expect(execute).toHaveBeenCalledWith('plan_ffmpeg', 'install'));
  });
});
