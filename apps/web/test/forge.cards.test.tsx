// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HarnessEvent } from '@harness-x/protocol';
import { BlockView } from '../src/chat/BlockView.js';
import { eventsToBlocks } from '../src/chat/blocks.js';
import { ForgeAnswerContext, type ForgeAnswerPayload } from '../src/forge/ForgeCards.js';

afterEach(cleanup);

const base = { id: 'e1', ts: '2026-11-11T00:00:00.000Z', sessionId: 's1' };

function show(event: HarnessEvent) {
  const onAnswer = vi.fn<(id: string, a: ForgeAnswerPayload) => void>();
  const [block] = eventsToBlocks([event]);
  render(
    <ForgeAnswerContext.Provider value={{ onAnswer }}>
      <BlockView block={block!} />
    </ForgeAnswerContext.Provider>,
  );
  return onAnswer;
}

describe('51.2 Forge 질문 카드 (선택지 버튼)', () => {
  it('선택지 버튼 + 제안 강조, 누르면 답변', () => {
    const onAnswer = show({
      ...base,
      type: 'approval_request',
      approvalId: 's1:q1',
      kind: 'forge_question',
      title: '무엇을 만들까요?',
      options: ['hook', 'skill'],
      detail: {
        questionId: 'kind',
        index: 1,
        total: 5,
        suggested: 'hook',
        choices: [
          { value: 'hook', label: '훅 — 이벤트에 반응하거나 막기' },
          { value: 'skill', label: '스킬 — SKILL.md 지침' },
        ],
      },
    });
    expect(screen.getByRole('group', { name: 'Forge 질문: 무엇을 만들까요?' })).toBeTruthy();
    expect(screen.getByText('1/5')).toBeTruthy();
    const hook = screen.getByRole('button', { name: '훅 — 이벤트에 반응하거나 막기' });
    expect(hook.getAttribute('data-suggested')).toBe('true');
    fireEvent.click(hook);
    expect(onAnswer).toHaveBeenCalledWith('s1:q1', { value: 'hook' });
    // 한 번 답하면 잠긴다
    expect((screen.getByRole('button', { name: '스킬 — SKILL.md 지침' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('여러 개 고르기: 토글 후 확인', () => {
    const onAnswer = show({
      ...base,
      type: 'approval_request',
      approvalId: 's1:q4',
      kind: 'forge_question',
      title: '어떤 권한이 필요하나요?',
      options: ['none', 'fs:read', 'shell'],
      detail: {
        questionId: 'permissions',
        multiple: true,
        suggested: ['shell'],
        choices: [
          { value: 'none', label: '권한 없음' },
          { value: 'fs:read', label: '워크스페이스 읽기' },
          { value: 'shell', label: '셸 명령 실행' },
        ],
      },
    });
    expect(screen.getByRole('button', { name: '셸 명령 실행' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '워크스페이스 읽기' }));
    fireEvent.click(screen.getByRole('button', { name: '확인' }));
    expect(onAnswer).toHaveBeenCalledWith('s1:q4', { value: ['shell', 'fs:read'] });
  });

  it('직접 입력', () => {
    const onAnswer = show({
      ...base,
      type: 'approval_request',
      approvalId: 's1:q5',
      kind: 'forge_question',
      title: '성공하면 어떻게 되어야 하나요?',
      options: ['default'],
      detail: { allowText: true, choices: [{ value: 'default', label: '기본 예시' }] },
    });
    fireEvent.change(screen.getByLabelText('직접 입력'), { target: { value: '린트 실패면 차단' } });
    fireEvent.click(screen.getByRole('button', { name: '확인' }));
    expect(onAnswer).toHaveBeenCalledWith('s1:q5', { value: 'text', text: '린트 실패면 차단' });
  });
});

describe('51.3 Forge spec 확인 카드', () => {
  it('spec 요약(종류·발동·권한·예시) + 확인/취소', () => {
    const onAnswer = show({
      ...base,
      type: 'approval_request',
      approvalId: 's1:spec',
      kind: 'forge_spec',
      title: 'PR 전 Kotlin 린트 가드 (hook) 이렇게 만들까요?',
      options: ['confirm', 'cancel'],
      detail: {
        spec: {
          id: 'pr-kotlin-guard',
          kind: 'hook',
          trigger: { hook: 'tool.before', match: 'gh pr create' },
          permissions: { fs: [], net: [], shell: true },
          examples: [{ name: '린트 실패 → 차단' }, { name: '린트 성공 → 허용' }],
        },
      },
    });
    const card = screen.getByRole('group', { name: /Forge spec 확인/ });
    expect(card.textContent).toContain('pr-kotlin-guard');
    expect(card.textContent).toContain('tool.before · gh pr create');
    expect(card.textContent).toContain('셸 실행');
    expect(card.textContent).toContain('린트 실패 → 차단, 린트 성공 → 허용');
    fireEvent.click(screen.getByRole('button', { name: '확인' }));
    expect(onAnswer).toHaveBeenCalledWith('s1:spec', { value: 'confirm' });
  });
});
