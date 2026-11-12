// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAttachUpload, type AttachUploadOptions } from '../src/composer/useAttachUpload.js';
import type { Attachment } from '../src/composer/types.js';

afterEach(cleanup);

let api: ReturnType<typeof useAttachUpload> | undefined;
function Probe(props: AttachUploadOptions) {
  api = useAttachUpload(props);
  return <span data-testid="status">{JSON.stringify(api.status)}</span>;
}

const att = (id: string, name: string, body: string): Attachment => ({
  id,
  name,
  mime: 'text/plain',
  size: body.length,
  source: 'drop',
  file: new File([body], name, { type: 'text/plain' }),
});

function fakeServer() {
  const calls: { path: string; method: string; body?: unknown }[] = [];
  let ready = false;
  const request = vi.fn(async (path: string, init?: RequestInit) => {
    calls.push({
      path,
      method: init?.method ?? 'GET',
      ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}),
    });
    if (init?.method === 'POST') {
      const files = (JSON.parse(String(init.body)) as { files: { name: string }[] }).files;
      return {
        attachments: files.map((_f, i) => ({ id: `att_00000000000${i}`, status: 'converting' })),
      } as never;
    }
    const st = ready ? 'ready' : 'converting';
    ready = true;
    return { attachments: [{ id: 'att_000000000000', status: st }] } as never;
  });
  return { calls, request };
}

describe('1A.7·1A.8 입력창 첨부 → 0-2 세션의 프로젝트 폴더로 올리기 (App 연결 훅)', () => {
  it('프로젝트·세션이 없으면 "어디서 작업할까요?" 먼저, 고른 뒤(세션 생김) 그 세션으로 올린다', async () => {
    const s = fakeServer();
    const askProject = vi.fn();
    const r = render(<Probe request={s.request} projectReady={false} askProject={askProject} pollMs={5} />);
    act(() => api!.onAttach({ type: 'attach', attachments: [att('ui-1', '기획서.hwpx', '내용')] }));
    expect(askProject).toHaveBeenCalledOnce();
    expect(s.request).not.toHaveBeenCalled();
    // 카드에서 프로젝트를 골라 초안 세션이 생김
    r.rerender(
      <Probe request={s.request} sessionId="draft-1" projectReady askProject={askProject} pollMs={5} />,
    );
    await waitFor(() => expect(s.calls[0]?.method).toBe('POST'));
    expect(s.calls[0]!.path).toBe('/api/sessions/draft-1/attachments');
    expect(s.calls[0]!.body).toEqual({
      files: [{ name: '기획서.hwpx', dataBase64: Buffer.from('내용').toString('base64') }],
    });
    // 칩 상태: 바꾸는 중 → (다시 읽기) ✓
    await waitFor(() => expect(api!.status['ui-1']?.status).toBe('ready'));
  });

  it('1A.7 초안 세션에 프로젝트가 있으면 카드 없이 바로 올린다 (서버가 초안을 정식 저장)', async () => {
    const s = fakeServer();
    const askProject = vi.fn();
    const onUploaded = vi.fn();
    render(
      <Probe
        request={s.request}
        sessionId="draft-7"
        projectReady
        askProject={askProject}
        onUploaded={onUploaded}
        pollMs={5}
      />,
    );
    act(() => api!.onAttach({ type: 'attach', attachments: [att('ui-2', 'a.txt', 'a')] }));
    await waitFor(() => expect(onUploaded).toHaveBeenCalledWith('draft-7'));
    expect(askProject).not.toHaveBeenCalled();
  });

  it('서버가 거절하면 칩에 ⚠ + 이유', async () => {
    const request = vi.fn(async () => {
      throw new Error('파일이 너무 커요. 한 파일은 200MB까지 넣을 수 있어요.');
    });
    render(<Probe request={request} sessionId="s" projectReady askProject={() => {}} />);
    act(() => api!.onAttach({ type: 'attach', attachments: [att('ui-3', 'big.bin', 'x')] }));
    await waitFor(() =>
      expect(api!.status['ui-3']).toEqual({
        status: 'failed',
        warning: '파일이 너무 커요. 한 파일은 200MB까지 넣을 수 있어요.',
      }),
    );
  });
});
