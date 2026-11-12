import { CLAUDE_CODE_INPUTS } from '@harness-x/engine-claude-code';
import { CODEX_INPUTS } from '@harness-x/engine-codex';
import {
  DELIVERY_NOTES,
  TEXT_ONLY_INPUTS,
  planDelivery,
  type Attachment,
  type EngineInputs,
  type Representation,
} from '@harness-x/protocol';
import { describe, expect, it } from 'vitest';

const MB = 1024 * 1024;
let n = 0;
function att(kind: Attachment['kind'], sizeBytes: number, reps: Representation['form'][] = []): Attachment {
  const id = `att_${String(++n).padStart(12, '0')}`;
  return {
    id,
    sha256: String(n).padStart(64, '0'),
    originalName: `${kind}-${n}`,
    sizeBytes,
    mime: kind === 'image' ? 'image/png' : kind === 'pdf' ? 'application/pdf' : 'application/octet-stream',
    kind,
    storedPath: `/p/${id}/original`,
    representations: reps.map((form) => ({
      form,
      path: `/p/${id}/${form}`,
      mime: form === 'thumbnail' ? 'image/jpeg' : 'text/plain',
      sizeBytes: form === 'thumbnail' ? MB : 100,
    })),
    warnings: [],
    status: 'ready',
  };
}

describe('1D.2 전달 방식 선택기: 직접 → 글 형태 → 이름·크기 + 안내 (조합 표)', () => {
  const engines: Record<string, EngineInputs> = {
    claude: CLAUDE_CODE_INPUTS,
    codex: CODEX_INPUTS,
    gemini: { image: true, pdf: true, audio: true, maxImageMB: 20 },
    text: TEXT_ONLY_INPUTS,
  };
  const cases: [string, Attachment][] = [
    ['그림 1MB', att('image', MB)],
    ['그림 30MB+축소본', att('image', 30 * MB, ['thumbnail'])],
    ['그림 30MB 축소본 없음', att('image', 30 * MB)],
    ['PDF 글 있음', att('pdf', MB, ['text'])],
    ['스캔 PDF 글 없음', att('pdf', MB, ['page-image'])],
    ['소리+받아쓰기', att('audio', MB, ['transcript'])],
    ['소리만', att('audio', MB)],
    ['XLSX', att('xlsx', MB, ['text'])],
    ['압축', att('archive', MB, ['listing'])],
    ['알 수 없음', att('unknown', MB)],
    ['비밀 가림', att('text', 100, ['text', 'masked-text'])],
  ];
  it('모든 조합', () => {
    const table = Object.fromEntries(
      cases.map(([label, a]) => [
        label,
        Object.fromEntries(
          Object.entries(engines).map(([e, inputs]) => {
            const d = planDelivery(a, inputs);
            const form = d.path?.split('/').pop();
            return [e, `${d.mode}${form ? `:${form}` : ''}`];
          }),
        ),
      ]),
    );
    expect(table).toEqual({
      '그림 1MB': {
        claude: 'native:original',
        codex: 'native:original',
        gemini: 'native:original',
        text: 'meta',
      },
      '그림 30MB+축소본': {
        claude: 'native:thumbnail',
        codex: 'native:thumbnail',
        gemini: 'native:thumbnail',
        text: 'meta',
      },
      '그림 30MB 축소본 없음': { claude: 'meta', codex: 'meta', gemini: 'meta', text: 'meta' },
      'PDF 글 있음': {
        claude: 'native:original',
        codex: 'text:text',
        gemini: 'native:original',
        text: 'text:text',
      },
      '스캔 PDF 글 없음': {
        claude: 'native:original',
        codex: 'meta',
        gemini: 'native:original',
        text: 'meta',
      },
      '소리+받아쓰기': {
        claude: 'text:transcript',
        codex: 'text:transcript',
        gemini: 'native:original',
        text: 'text:transcript',
      },
      소리만: { claude: 'meta', codex: 'meta', gemini: 'native:original', text: 'meta' },
      XLSX: { claude: 'text:text', codex: 'text:text', gemini: 'text:text', text: 'text:text' },
      압축: { claude: 'text:listing', codex: 'text:listing', gemini: 'text:listing', text: 'text:listing' },
      '알 수 없음': { claude: 'meta', codex: 'meta', gemini: 'meta', text: 'meta' },
      '비밀 가림': {
        claude: 'text:masked-text',
        codex: 'text:masked-text',
        gemini: 'text:masked-text',
        text: 'text:masked-text',
      },
    });
  });

  it('안내 문구: 그림을 못 보는 AI → 글로 / 이름·크기만', () => {
    const img = att('image', MB, ['text']);
    expect(planDelivery(img, TEXT_ONLY_INPUTS).note).toBe(DELIVERY_NOTES.imageAsText);
    expect(DELIVERY_NOTES.imageAsText).toBe('이 AI는 그림을 직접 못 봐요 → 글로 바꿔서 보낼게요.');
    expect(planDelivery(att('image', MB), TEXT_ONLY_INPUTS).note).toBe(DELIVERY_NOTES.imageMeta);
    expect(planDelivery(att('unknown', 1), CLAUDE_CODE_INPUTS).note).toBe(DELIVERY_NOTES.metaOnly);
  });
});
