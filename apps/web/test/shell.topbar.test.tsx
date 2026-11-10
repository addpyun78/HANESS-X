// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { TopBar } from '../src/shell/TopBar.js';

afterEach(cleanup);

describe('상단 바', () => {
  it('워크스페이스 이름·실제 경로·브랜치, 실행 상태, 엔진별 쿼터 미터 자리 (스냅샷)', () => {
    const { container } = render(
      <TopBar
        workspace={{ name: 'harness-x', path: 'C:\\agentCli\\harness-x', branch: 'main' }}
        runState="running"
        quotas={[
          { engineId: 'claude-code', label: 'Claude', ratio: 0.42 },
          { engineId: 'codex', label: 'Codex', ratio: 0.93 },
          { engineId: 'antigravity', label: 'Antigravity' },
        ]}
      />,
    );
    expect(screen.getByText('harness-x')).toBeTruthy();
    expect(screen.getByText('C:\\agentCli\\harness-x')).toBeTruthy();
    expect(screen.getByLabelText('브랜치 main')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('실행 중');
    const meters = screen.getAllByRole('meter');
    expect(meters.map((m) => m.getAttribute('aria-valuenow'))).toEqual(['42', '93', null]);
    expect(container.querySelector('[data-engine="codex"]')?.getAttribute('data-level')).toBe('warning'); // 60.2: 95% 미만은 노랑
    expect(container.innerHTML).toMatchSnapshot();
  });

  it('워크스페이스가 없으면 안내 문구', () => {
    const { container } = render(<TopBar runState="idle" quotas={[]} />);
    expect(screen.getByText('프로젝트를 선택하세요')).toBeTruthy();
    expect(container.innerHTML).toMatchSnapshot();
  });
});
