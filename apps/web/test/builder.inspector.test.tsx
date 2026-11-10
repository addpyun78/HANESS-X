// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { BuilderPage } from '../src/builder/BuilderPage.js';
import { DEFAULT_CATALOG } from '../src/builder/catalog.js';
import { emptyGraph, type BuilderGraph } from '../src/builder/graph.js';
import { inspectorReducer, patchSpec } from '../src/builder/inspector/model.js';
import { blockTransfer, mockReactFlowDom } from './flow-mock.js';

beforeAll(mockReactFlowDom);
afterEach(cleanup);

const canvas = () => document.querySelector('.hx-canvas') as HTMLElement;
const node = (id: string) => document.querySelector(`.hx-node[data-node-id="${id}"]`) as HTMLElement;

function start() {
  render(<BuilderPage route="/builder/new" catalog={DEFAULT_CATALOG} />);
  fireEvent.click(screen.getByText('빈 캔버스'));
  fireEvent.drop(canvas(), { dataTransfer: blockTransfer('node', 'role'), clientX: 50, clientY: 50 });
}

const roleGraph = (): BuilderGraph =>
  inspectorReducer(emptyGraph(), { type: 'addNode', nodeType: 'role', position: { x: 0, y: 0 } });

describe('46.1 노드 인스펙터 — 편집이 그래프에 반영', () => {
  it('patchNode: 이름·엔진·인증 모드·권한·체크리스트 템플릿·입출력 스키마', () => {
    let g = roleGraph();
    g = inspectorReducer(g, {
      type: 'patchNode',
      nodeId: 'role',
      patch: {
        label: '구현',
        engine: 'codex',
        mode: 'apiKey',
        permission: 'read-only',
        checklistTemplate: 'templates/build.yaml',
        inputSchema: { type: 'object', properties: { tasks: { type: 'array' } } },
        outputSchema: { type: 'object', required: ['files'] },
      },
    });
    expect(g.nodes[0]!.spec).toMatchObject({
      label: '구현',
      engine: 'codex',
      mode: 'apiKey',
      permission: 'read-only',
      checklistTemplate: 'templates/build.yaml',
      inputSchema: { type: 'object', properties: { tasks: { type: 'array' } } },
      outputSchema: { type: 'object', required: ['files'] },
    });
    // 빈 값 = 필드 삭제, 같은 값 = 그대로(같은 객체)
    const cleared = inspectorReducer(g, {
      type: 'patchNode',
      nodeId: 'role',
      patch: { checklistTemplate: '' },
    });
    expect('checklistTemplate' in cleared.nodes[0]!.spec).toBe(false);
    expect(inspectorReducer(g, { type: 'patchNode', nodeId: 'role', patch: { engine: 'codex' } })).toBe(g);
  });

  it('종류에 없는 필드는 무시 (gate에 engine 없음)', () => {
    const gate = { id: 'g', type: 'gate' as const, verifiers: [] };
    expect(patchSpec(gate, { engine: 'codex', mode: 'apiKey' })).toBe(gate);
    expect(patchSpec(gate, { label: '검사' })).toEqual({ ...gate, label: '검사' });
  });

  it('reorderSkill: 스킬 순서 바꾸기', () => {
    let g = roleGraph();
    for (const skill of ['a', 'b', 'c'])
      g = inspectorReducer(g, { type: 'attachSkill', nodeId: 'role', skill });
    g = inspectorReducer(g, { type: 'reorderSkill', nodeId: 'role', from: 2, to: 0 });
    expect(g.nodes[0]!.spec).toMatchObject({ skills: ['c', 'a', 'b'] });
    expect(inspectorReducer(g, { type: 'reorderSkill', nodeId: 'role', from: 0, to: 9 })).toBe(g);
  });

  it('화면: 선택 노드 필드를 고치면 캔버스 노드 카드가 바뀐다', () => {
    start();
    fireEvent.change(screen.getByLabelText('노드 이름'), { target: { value: '계획' } });
    expect(node('role').querySelector('.hx-node__label')?.textContent).toBe('계획');
    fireEvent.change(screen.getByLabelText('노드 엔진'), { target: { value: 'codex' } });
    expect(node('role').querySelector('.hx-engine-chip')?.getAttribute('data-engine')).toBe('codex');
    fireEvent.change(screen.getByLabelText('인증 모드'), { target: { value: 'apiKey' } });
    fireEvent.change(screen.getByLabelText('노드 권한'), { target: { value: 'read-only' } });
    fireEvent.change(screen.getByLabelText('체크리스트 템플릿'), { target: { value: 'plan.yaml' } });

    // 스킬 순서
    fireEvent.drop(node('role'), { dataTransfer: blockTransfer('skill', 'a11y-check') });
    fireEvent.drop(node('role'), { dataTransfer: blockTransfer('skill', 'code-review') });
    fireEvent.click(screen.getByLabelText('code-review 위로'));
    const chips = Array.from(node('role').querySelectorAll('.hx-skill-chip')).map((c) =>
      c.getAttribute('data-skill'),
    );
    expect(chips).toEqual(['code-review', 'a11y-check']);

    // 출력 스키마: 잘못된 JSON은 오류, 올바르면 적용 → YAML에 반영
    const out = screen.getByLabelText('출력 스키마');
    fireEvent.change(out, { target: { value: '{bad' } });
    fireEvent.blur(out);
    expect(screen.getByRole('alert').textContent).toBeTruthy();
    fireEvent.change(out, { target: { value: '{"type":"object","required":["tasks"]}' } });
    fireEvent.blur(out);
    expect(screen.queryByRole('alert')).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'YAML 보기' }));
    const yaml = (screen.getByLabelText('pipeline.yaml') as HTMLTextAreaElement).value;
    expect(yaml).toContain('label: 계획');
    expect(yaml).toContain('engine: codex');
    expect(yaml).toContain('mode: apiKey');
    expect(yaml).toContain('permission: read-only');
    expect(yaml).toContain('checklistTemplate: plan.yaml');
    expect(yaml).toMatch(/skills:\n\s+- code-review\n\s+- a11y-check/);
    expect(yaml).toContain('required:');

    // Ctrl+Z로 인스펙터 편집도 되돌린다
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    fireEvent.click(within(screen.getByRole('tablist', { name: '인스펙터 탭' })).getByText('노드'));
    expect((screen.getByLabelText('출력 스키마') as HTMLTextAreaElement).value).toBe('');
  });
});
