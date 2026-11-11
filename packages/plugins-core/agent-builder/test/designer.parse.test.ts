import { describe, expect, it } from 'vitest';
import { Designer } from '../src/designer/designer.js';
import { parseDesignerReply } from '../src/designer/parse.js';
import { designerInventory, replayAsk, sampleDraft } from './designer-helpers.js';

const good = () => JSON.stringify(sampleDraft());
const req = '임장노트 화면 디자인 검수 에이전트 만들어 줘';

describe('P4-C.5 응답 파싱: JSON만 추출(T-042 재사용), 스키마 실패 시 오류 목록과 1회 재요청', () => {
  it('설명 글·펜스 사이의 JSON만 꺼낸다 (마지막 JSON 객체)', () => {
    const text = `네, 만들어 봤어요.\n\n\`\`\`json\n${good()}\n\`\`\`\n이대로 저장해 주세요!`;
    const r = parseDesignerReply(text);
    expect(r.kind).toBe('draft');
  });

  it('깨진 응답 리플레이: JSON 없음 → 재요청 1회 → 성공', async () => {
    const r = replayAsk(['초안을 만들고 있어요... {"name": "design-review", "nodes": [', good()]);
    const res = await new Designer({ ask: r.ask, inventory: () => designerInventory() }).design(req, {
      skipQuestions: true,
    });
    expect(res.kind).toBe('draft');
    expect(r.calls()).toBe(2);
    expect(r.prompts[1]!.user).toContain('JSON 객체를 찾지 못했습니다');
  });

  it('스키마 위반 → 오류 목록(누락 필드·잘못된 값)을 넣어 재요청', async () => {
    const broken = { ...sampleDraft(), command: 'design-review', summary: '한 줄' } as Record<
      string,
      unknown
    >;
    delete broken.estimatedCostHint;
    const r = replayAsk([broken, good()]);
    const res = await new Designer({ ask: r.ask, inventory: () => designerInventory() }).design(req, {
      skipQuestions: true,
    });
    expect(res.kind).toBe('draft');
    const fix = r.prompts[1]!.user;
    expect(fix).toContain('command:');
    expect(fix).toContain('summary:');
    expect(fix).toContain('estimatedCostHint:');
  });

  it('재요청은 1회뿐: 두 번 다 깨지면 실패(쉬운 말 안내), 설계 AI 호출 2회', async () => {
    const r = replayAsk(['그냥 글', '또 글']);
    const res = await new Designer({ ask: r.ask, inventory: () => designerInventory() }).design(req, {
      skipQuestions: true,
    });
    expect(res.kind).toBe('failed');
    expect(r.calls()).toBe(2);
  });

  it('어려운 말 reason도 스키마 오류처럼 재요청 목록에 들어간다', async () => {
    const hard = sampleDraft();
    hard.nodes[0]!.reason = 'JSON schema parse 결과로 regex 정규식을 씀';
    const r = replayAsk([hard, good()]);
    await new Designer({ ask: r.ask, inventory: () => designerInventory() }).design(req, {
      skipQuestions: true,
    });
    expect(r.prompts[1]!.user).toContain('nodes[0].reason: not plain Korean');
  });
});
