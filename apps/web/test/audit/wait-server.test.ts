// T-102 I.2 재현: 서버가 늦게 켜지면 화면은 기다렸다가 진행해야 한다(예전엔 첫 실패 뒤 다시 부르지 않아 패널이 비었음)
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../src/api/client.js';
import { SERVER_NOT_STARTED, SERVER_STARTING, waitForServer } from '../../src/api/wait-server.js';
import { checkPlainKorean } from '../../../../packages/plugins-core/approvals/src/plain-korean.js';

describe('서버가 켜질 때까지 기다리기 (T-102 I.2)', () => {
  it('연결 실패·502 동안 기다리고, 답하면 true', async () => {
    let n = 0;
    const seen: number[] = [];
    let t = 0;
    const client = {
      health: async () => {
        n++;
        if (n === 1) throw new TypeError('Failed to fetch');
        if (n === 2) throw new ApiError(502, {});
        return { ok: true };
      },
    };
    const ok = await waitForServer(client, {
      onWaiting: (s) => seen.push(s),
      sleep: async () => void (t += 1500),
      now: () => t,
    });
    expect(ok).toBe(true);
    expect(n).toBe(3);
    expect(seen).toEqual([0, 2]);
  });
  it('401·404처럼 서버가 답하면 바로 true', async () => {
    expect(await waitForServer({ health: async () => Promise.reject(new ApiError(404, {})) })).toBe(true);
    expect(await waitForServer({ health: async () => Promise.reject(new ApiError(401, {})) })).toBe(true);
  });
  it('끝까지 안 켜지면 false', async () => {
    let t = 0;
    const ok = await waitForServer(
      { health: async () => Promise.reject(new TypeError('x')) },
      { maxMs: 5000, sleep: async () => void (t += 1500), now: () => t },
    );
    expect(ok).toBe(false);
  });
  it('안내 문구는 쉬운 말', () => {
    expect(checkPlainKorean(SERVER_STARTING(12)).ok).toBe(true);
    expect(checkPlainKorean(SERVER_NOT_STARTED).ok).toBe(true);
  });
});
