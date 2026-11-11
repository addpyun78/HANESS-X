import { readFileSync } from 'node:fs';
import type { UserMedia } from '@harness-x/kernel';
import {
  TEXT_ONLY_INPUTS,
  planDeliveries,
  promptWithAttachments,
  type Attachment,
  type EngineInputs,
} from '@harness-x/protocol';

/**
 * T-101 1D.4 API 엔진 / 1D.5 로컬 LLM 첨부 전달.
 * 지원 모델이면 그림·PDF를 직접 블록으로(크기 초과 시 축소본), 아니면 글 형태를 프롬프트에 넣는다.
 */

/** 그림을 볼 수 있는 모델 이름 (OpenAI 호환·Ollama) */
export const VISION_MODEL_RE =
  /(llava|bakllava|vision|[-_.]vl\b|vl:|qwen2\.5vl|qwen2-vl|qwen3-vl|gemma3|minicpm-v|moondream|llama4|mistral-small3|gpt-4o|gpt-4\.1|gpt-5|\bo3\b|\bo4)/i;

export type ApiProviderKind = 'openai-compat' | 'deepseek' | 'anthropic' | 'gemini';

/** 1D.1 공급자·모델별 입력 능력 */
export function apiInputs(provider: ApiProviderKind, model: string | undefined, local = false): EngineInputs {
  if (provider === 'anthropic') return { image: true, pdf: true, audio: false, maxImageMB: 5 };
  if (provider === 'gemini') return { image: true, pdf: true, audio: true, maxImageMB: 20 };
  if (provider === 'deepseek') return TEXT_ONLY_INPUTS;
  if (model && VISION_MODEL_RE.test(model))
    return { image: true, pdf: false, audio: false, maxImageMB: local ? 10 : 20 };
  return TEXT_ONLY_INPUTS;
}

/** 글 형태를 프롬프트에 넣을 때 한 파일 최대 글자 수 (넘으면 attachments.read로 이어 읽기) */
export const INLINE_TEXT_MAX = 100_000;

export interface ApiAttachmentInput {
  prompt: string;
  media: UserMedia[];
}

export function buildApiAttachmentInput(
  prompt: string,
  attachments: readonly Attachment[] | undefined,
  inputs: EngineInputs,
  read: (path: string) => Buffer = (p) => readFileSync(p),
): ApiAttachmentInput {
  if (!attachments?.length) return { prompt, media: [] };
  const ds = planDeliveries(attachments, inputs);
  const media: UserMedia[] = [];
  const texts: string[] = [];
  for (const d of ds) {
    if (d.mode === 'native' && d.path && d.as)
      media.push({
        kind: d.as,
        mime: d.mime ?? d.attachment.mime,
        data: read(d.path).toString('base64'),
        name: d.attachment.originalName,
      });
    else if (d.mode === 'text' && d.path) {
      const body = read(d.path).toString('utf8');
      const cut = body.length > INLINE_TEXT_MAX;
      texts.push(
        `### ${d.attachment.originalName} (글 형태${d.note ? ` — ${d.note}` : ''})\n\n` +
          '```\n' +
          (cut ? body.slice(0, INLINE_TEXT_MAX) : body) +
          '\n```' +
          (cut ? `\n(뒤는 attachments.read로 이어 읽으세요: id ${d.attachment.id})` : ''),
      );
    }
  }
  const head = promptWithAttachments(prompt, ds, '그림·PDF가 직접 붙어 있으면 그것을 보세요.');
  return { prompt: texts.length ? `${head}\n\n${texts.join('\n\n')}` : head, media };
}
