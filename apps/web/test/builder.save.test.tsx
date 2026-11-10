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
    const calls: [string, SaveAgentRequest][] = [];
    const save = vi.fn(async (name: string, body: SaveAgentRequest) => {
      calls.push([name, body]);
      if (calls.length === 1) throw new ApiError(409, { error: 'exists' });
      return { name, command: body.agent.command, dir: `/h/agents/${name}`, files: [], created: false };
    });
    render(<BuilderPage route="/builder/new" catalog={DEFAULT_CATALOG} saveAgent={save} />);
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
});
