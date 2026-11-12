// @vitest-environment jsdom
/** T-101 0C.4 검사기 자체 검사: 일부러 만든 죽은 버튼 1개를 찾아낸다 */
import { render } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { act } from '../src/actions/registry.js';
import { clickAll, failures } from './click-all/click-all.js';

function Fixture({ onSave }: { onSave: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button {...act('approvals.more')} type="button" onClick={() => setOpen(!open)}>
        펼치기
      </button>
      {open && <p>내용</p>}
      <button
        {...act('save.save')}
        type="button"
        onClick={() => void fetch('/api/agents', { method: 'POST' })}
      >
        저장
      </button>
      <button {...act('subagent.cancel')} type="button" onClick={onSave}>
        닫기
      </button>
      <a {...act('engines.install-guide')} href="#/somewhere">
        안내
      </a>
      <button {...act('nav.settings')} type="button" onClick={() => {}}>
        설정 (죽은 버튼)
      </button>
      <button type="button" onClick={() => setOpen(!open)}>
        이름표 없음
      </button>
      <button {...act('builder.undo')} type="button" disabled title="되돌릴 것이 없어요">
        되돌리기
      </button>
    </div>
  );
}

describe('0C.4 전부 눌러 보기 — 검사기 자체', () => {
  it('일부러 만든 죽은 버튼 1개를 실패로 잡고, 효과 있는 버튼은 통과, 비활성 버튼은 누르지 않는다', async () => {
    const rs = await clickAll('fixture', (h) => {
      h.server({ 'POST /api/agents': () => ({ ok: true }) });
      render(<Fixture onSave={h.cb()} />);
    });
    expect(rs.map((r) => r.label)).toEqual([
      '펼치기',
      '저장',
      '닫기',
      '안내',
      '설정 (죽은 버튼)',
      '이름표 없음',
    ]);
    expect(rs.find((r) => r.label === '펼치기')?.observed).toContain('dom');
    expect(rs.find((r) => r.label === '저장')?.observed).toContain('api');
    expect(rs.find((r) => r.label === '닫기')?.observed).toContain('event');
    expect(rs.find((r) => r.label === '안내')?.observed).toContain('navigate');
    expect(failures(rs).map((r) => [r.problem, r.label])).toEqual([
      ['dead', '설정 (죽은 버튼)'],
      ['no-action', '이름표 없음'],
    ]);
  }, 120_000);
});
