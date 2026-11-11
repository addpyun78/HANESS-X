// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NO_PROJECT_MESSAGE, runAttachFlow, type UiSession } from '../src/composer/attach-flow.js';
import { Composer } from '../src/composer/Composer.js';
import { ENGINES } from './composer.helpers.js';

afterEach(cleanup);

/** 0-2·0B.15가 생기기 전까지 쓰는 흉내 화면: 입력창 + "어디서 작업할까요?" 카드 */
function Harness(props: {
  session: UiSession;
  saveDraft: (s: UiSession, root: string) => Promise<string>;
  upload: (sid: string, root: string, names: string[]) => Promise<void>;
}) {
  const [card, setCard] = useState(false);
  const resolver = useRef<(v: string | undefined) => void>(() => {});
  const session = useRef(props.session);
  return (
    <>
      {card && (
        <div role="dialog" aria-label="프로젝트 고르기">
          <p>{NO_PROJECT_MESSAGE}</p>
          <button onClick={() => (setCard(false), resolver.current('/projects/집값'))}>집값</button>
          <button onClick={() => (setCard(false), resolver.current(undefined))}>닫기</button>
        </div>
      )}
      <Composer
        engines={ENGINES}
        onSend={() => {}}
        onAttach={(e) =>
          void runAttachFlow(
            {
              currentSession: () => session.current,
              pickProject: () =>
                new Promise((res) => {
                  resolver.current = res;
                  setCard(true);
                }),
              saveDraft: async (s, root) => {
                const id = await props.saveDraft(s, root);
                session.current = { id, draft: false, projectRoot: root };
                return id;
              },
              upload: (sid, root, files) =>
                props.upload(
                  sid,
                  root,
                  files.map((f) => f.name),
                ),
            },
            e.attachments,
          )
        }
      />
    </>
  );
}

const drop = (name: string) =>
  fireEvent.drop(document.querySelector('.hx-composer')!, {
    dataTransfer: { files: [new File(['x'], name, { type: 'text/plain' })] },
  });

describe('1A.8 프로젝트 없이 파일을 놓으면 "어디서 작업할까요?" 카드 먼저', () => {
  it('카드에서 고른 프로젝트로 초안 세션을 저장하고 그곳에 올린다', async () => {
    const saveDraft = vi.fn(async () => 's-1');
    const upload = vi.fn(async () => {});
    render(<Harness session={{ id: 'draft-1', draft: true }} saveDraft={saveDraft} upload={upload} />);
    drop('기획서.hwpx');
    expect(await screen.findByText(NO_PROJECT_MESSAGE)).toBeTruthy();
    expect(upload).not.toHaveBeenCalled();
    await act(async () => fireEvent.click(screen.getByText('집값')));
    await waitFor(() => expect(upload).toHaveBeenCalledWith('s-1', '/projects/집값', ['기획서.hwpx']));
    expect(saveDraft).toHaveBeenCalledWith({ id: 'draft-1', draft: true }, '/projects/집값');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('카드를 닫으면 저장·올리기 없음', async () => {
    const saveDraft = vi.fn(async () => 's-1');
    const upload = vi.fn(async () => {});
    render(<Harness session={{ id: 'draft-1', draft: true }} saveDraft={saveDraft} upload={upload} />);
    drop('a.txt');
    await act(async () => fireEvent.click(await screen.findByText('닫기')));
    expect(saveDraft).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });

  it('1A.7 프로젝트가 있는 초안 세션은 카드 없이 바로 정식 저장', async () => {
    const saveDraft = vi.fn(async () => 's-7');
    const upload = vi.fn(async () => {});
    render(
      <Harness
        session={{ id: 'draft-7', draft: true, projectRoot: '/p' }}
        saveDraft={saveDraft}
        upload={upload}
      />,
    );
    drop('a.txt');
    await waitFor(() => expect(upload).toHaveBeenCalledWith('s-7', '/p', ['a.txt']));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
