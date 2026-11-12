// @vitest-environment jsdom
// @features F-129
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DryRunTab } from '../src/builder/inspector/DryRunTab.js';
import { dryRunEvents, overlayFromEvents, type Overlay } from '../src/builder/inspector/dryrun.js';
import { stageRunView } from '../src/builder/inspector/dryrun-stages.js';
import { graphFromYaml } from '../src/builder/inspector/yaml.js';

afterEach(cleanup);

const DESIGN_QA = readFileSync(join(process.cwd(), 'examples/agents/design-qa/pipeline.yaml'), 'utf8');

function fixture() {
  const r = graphFromYaml(DESIGN_QA);
  if (!r.ok) throw new Error('fixture');
  return r;
}

describe('4F.5 빌더 시험 실행 오버레이에 단계별 진행', () => {
  it('리플레이 단계마다 "단계 k/n"과 단계 상태', () => {
    const { pipeline } = fixture();
    const ev = dryRunEvents(pipeline, '로그인 화면');
    const ids = pipeline.nodes.map((n) => n.id);
    const at = (k: number) => stageRunView(pipeline, overlayFromEvents(ev.slice(0, k), ids));
    expect(at(0)).toMatchObject({ label: '단계 1/3' });
    // build 시작 직후
    const k = ev.findIndex((e) => e.type === 'node_start' && e.nodeId === 'build') + 1;
    expect(at(k).label).toBe('단계 2/3');
    expect(at(k).rows.map((r) => `${r.nodeId}:${r.status}`)).toEqual([
      'plan:completed',
      'build:running',
      'critic:pending',
    ]);
    expect(at(ev.length).label).toBe('단계 3/3');
  });

  it('시험 실행 탭에 단계별 진행 표시 (스냅샷)', () => {
    const { graph, meta, pipeline } = fixture();
    let overlay: Overlay | undefined;
    const { rerender, container } = render(
      <DryRunTab graph={graph} meta={meta} overlay={overlay} onOverlay={(o) => (overlay = o)} stepMs={0} />,
    );
    fireEvent.click(screen.getByRole('button', { name: '시험 실행' }));
    rerender(
      <DryRunTab graph={graph} meta={meta} overlay={overlay} onOverlay={(o) => (overlay = o)} stepMs={0} />,
    );
    expect(screen.getByTestId('dryrun-stage-progress').textContent).toBe('단계 3/3');
    const list = screen.getByRole('list', { name: '단계별 진행' });
    expect(list.querySelectorAll('li')).toHaveLength(
      pipeline.nodes.filter((n) => n.type !== 'router').length,
    );
    expect(container.querySelector('.hx-dryrun__stages')!.outerHTML).toMatchSnapshot();
  });
});
