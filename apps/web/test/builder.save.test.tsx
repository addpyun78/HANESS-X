// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ApiError, type SaveAgentRequest } from '../src/api/client.js';
import { BuilderPage } from '../src/builder/BuilderPage.js';
import { DEFAULT_CATALOG } from '../src/builder/catalog.js';
import { suggestCommand, toAgentName, validateAgentName } from '../src/builder/inspector/save.js';
import { blockTransfer, mockReactFlowDom } from './flow-mock.js';

beforeAll(mockReactFlowDom);
afterEach(cleanup);

describe('46.3 저장 — 이름에 슬래시 명령 자동 제안', () => {
  it('이름 정규화·명령 제안·검증', () => {
    expect(toAgentName('Design QA 2')).toBe('design-qa-2');
    expect(toAgentName('디자인')).toBe('my-agent');
    expect(toAgentName('9lives')).toBe('lives');
    expect(suggestCommand('my-qa')).toBe('/my-qa');
    expect(validateAgentName('my-qa')).toBeUndefined();
    expect(validateAgentName('My QA')).toBeTruthy();
  });

  it('화면: 이름 입력 → /명령 제안 → 저장 요청(agent + pipeline), 409면 덮어쓰기', async () => {
    const calls: [string, SaveAgentRequest, string][] = [];
    const order: string[] = [];
    let n = 0;
    const gestureToken = vi.fn(async (kind: 'save-agent') => {
      order.push(`gesture:${kind}`);
      return `g${++n}`;
    });
    const save = vi.fn(async (name: string, body: SaveAgentRequest, token: string) => {
      order.push(`save:${token}`);
      calls.push([name, body, token]);
      if (calls.length === 1) throw new ApiError(409, { error: 'exists' });
      return { name, command: body.agent.command, dir: `/h/agents/${name}`, files: [], created: false };
    });
    render(
      <BuilderPage
        route="/builder/new"
        catalog={DEFAULT_CATALOG}
        saveAgent={save}
        saveGestureToken={gestureToken}
      />,
    );
    fireEvent.click(screen.getByText('빈 캔버스'));
    const canvas = document.querySelector('.hx-canvas') as HTMLElement;
    fireEvent.drop(canvas, { dataTransfer: blockTransfer('node', 'role'), clientX: 50, clientY: 50 });

    fireEvent.change(screen.getByLabelText('에이전트 이름'), { target: { value: 'ui-review' } });
    expect((screen.getByLabelText('슬래시 명령') as HTMLInputElement).value).toBe('/ui-review');
    fireEvent.change(screen.getByLabelText('표시 이름'), { target: { value: 'UI 리뷰' } });

    // 잘못된 이름이면 저장 버튼 비활성
    fireEvent.change(screen.getByLabelText('에이전트 이름'), { target: { value: 'UI Review' } });
    expect((screen.getByText('저장') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('에이전트 이름'), { target: { value: 'ui-review' } });

    fireEvent.click(screen.getByText('저장'));
    await screen.findByText('덮어쓰기');
    fireEvent.click(screen.getByText('덮어쓰기'));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('/ui-review'));

    expect(calls).toHaveLength(2);
    // P4-F.2: 클릭마다 새 클릭 토큰을 먼저 받고 그 토큰으로 저장
    expect(order).toEqual(['gesture:save-agent', 'save:g1', 'gesture:save-agent', 'save:g2']);
    const [name, body] = calls[1]!;
    expect(name).toBe('ui-review');
    expect(body.overwrite).toBe(true);
    expect(body.agent).toMatchObject({
      name: 'ui-review',
      displayName: 'UI 리뷰',
      command: '/ui-review',
      pipeline: './pipeline.yaml',
    });
    expect(body.pipeline.name).toBe('ui-review');
    expect(body.pipeline.nodes.map((n) => n.id)).toEqual(['role']);
  });

  it('P4-F.2 보강: 클릭 토큰이 거절되면(403) 저장됐다고 하지 않고 쉬운 말 안내', async () => {
    const gestureToken = vi.fn(async () => 'stale');
    const save = vi.fn(async () => {
      throw new ApiError(403, {
        error: 'gesture_required',
        reason: 'reused',
        message: '이미 쓴 클릭 확인이에요. 화면에서 다시 눌러 주세요.',
      });
    });
    render(
      <BuilderPage
        route="/builder/new"
        catalog={DEFAULT_CATALOG}
        saveAgent={save}
        saveGestureToken={gestureToken}
      />,
    );
    fireEvent.click(screen.getByText('빈 캔버스'));
    const canvas = document.querySelector('.hx-canvas') as HTMLElement;
    fireEvent.drop(canvas, { dataTransfer: blockTransfer('node', 'role'), clientX: 50, clientY: 50 });
    fireEvent.change(screen.getByLabelText('에이전트 이름'), { target: { value: 'ui-review' } });
    fireEvent.click(screen.getByText('저장'));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('이미 쓴 클릭 확인'));
    expect(screen.getByRole('status').textContent).not.toContain('저장됨');
    expect(gestureToken).toHaveBeenCalledTimes(1);
  });

  it('클릭 토큰 함수가 없으면 저장 버튼 비활성 (세션 토큰만으로 저장 금지)', () => {
    const save = vi.fn();
    render(<BuilderPage route="/builder/new" catalog={DEFAULT_CATALOG} saveAgent={save} />);
    fireEvent.click(screen.getByText('빈 캔버스'));
    const canvas = document.querySelector('.hx-canvas') as HTMLElement;
    fireEvent.drop(canvas, { dataTransfer: blockTransfer('node', 'role'), clientX: 50, clientY: 50 });
    expect((screen.getByText('저장') as HTMLButtonElement).disabled).toBe(true);
  });
});
