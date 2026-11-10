// @vitest-environment jsdom
import { render, screen, fireEvent } from '@testing-library/react';
import { useContext } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { HarnessApiClient } from '../src/api/client.js';
import { ForgeAnswerContext } from '../src/forge/ForgeCards.js';

function Probe() {
  const actions = useContext(ForgeAnswerContext);
  return <button onClick={() => actions?.onAnswer('fq-1', { value: 'hook' })}>답</button>;
}

describe('Forge 카드 답 → API', () => {
  it('forgeAnswer가 POST /api/forge/answers/:id로 보낸다', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ approvalId: 'fq-1' }), { status: 200 }),
    );
    const client = new HarnessApiClient({
      token: 't',
      baseUrl: 'http://x',
      fetch: fetchMock as unknown as typeof fetch,
    });
    render(
      <ForgeAnswerContext.Provider value={{ onAnswer: (id, a) => void client.forgeAnswer(id, a) }}>
        <Probe />
      </ForgeAnswerContext.Provider>,
    );
    fireEvent.click(screen.getByText('답'));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://x/api/forge/answers/fq-1');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ value: 'hook' });
  });
});
