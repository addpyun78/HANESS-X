// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TransferSection } from '../src/settings/sections/TransferSection.js';

/** T-101 6C.3 설정 파일 화면: [설정 내보내기] → settings.yaml 내려받기, [설정 가져오기] → 결과·고칠 값 목록 (왕복은 커널 settings.transfer.test.ts) */

afterEach(cleanup);

const YAML = '# HARNESS-X 설정 파일 — 키(비밀 값)는 들어 있지 않아요.\njudge:\n  semantic: off\n';

describe('6C.3 설정 내보내기/가져오기 화면', () => {
  it('내보내기 → settings.yaml 내려받기, 가져오기 성공 → 몇 개 가져왔는지 + 화면 다시 읽기', async () => {
    const download = vi.fn();
    const onImported = vi.fn();
    const importYaml = vi.fn(async () => ({ ok: true as const, imported: ['judge.semantic'] }));
    render(
      <TransferSection
        extras={{ exportYaml: async () => ({ file: 'settings.yaml', text: YAML }), importYaml }}
        download={download}
        onImported={onImported}
      />,
    );
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '설정 내보내기' })));
    expect(download).toHaveBeenCalledWith('settings.yaml', YAML);
    const input = screen.getByLabelText('설정 가져오기') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, {
        target: { files: [new File([YAML], 'settings.yaml', { type: 'text/yaml' })] },
      });
    });
    await vi.waitFor(() => expect(importYaml).toHaveBeenCalledWith(YAML));
    expect((await screen.findByRole('status')).textContent).toBe('설정 1개를 가져왔어요.');
    expect(onImported).toHaveBeenCalled();
  });

  it('가져오기 실패 → 아무것도 바꾸지 않았다는 안내 + 고칠 값 목록', async () => {
    const err = Object.assign(new Error('400'), {
      status: 400,
      body: {
        error: 'invalid_import',
        message: '가져오지 않았어요. 아래 값을 고쳐 주세요.',
        issues: [{ key: 'judge.samples', message: '3 이하로 넣어 주세요.' }],
      },
    });
    render(
      <TransferSection
        extras={{
          exportYaml: async () => ({ file: 'settings.yaml', text: YAML }),
          importYaml: async () => {
            throw err;
          },
        }}
      />,
    );
    await act(async () => {
      fireEvent.change(screen.getByLabelText('설정 가져오기'), {
        target: { files: [new File(['judge:\n  samples: 9\n'], 'settings.yaml')] },
      });
    });
    expect((await screen.findByRole('status')).textContent).toBe('가져오지 않았어요. 아래 값을 고쳐 주세요.');
    expect(screen.getByRole('list', { name: '고칠 값' }).textContent).toContain(
      'judge.samples 3 이하로 넣어 주세요.',
    );
  });
});
