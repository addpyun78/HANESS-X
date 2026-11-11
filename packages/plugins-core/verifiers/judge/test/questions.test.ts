import { describe, expect, it } from 'vitest';
import {
  answerJsonSchema,
  buildJudgePrompt,
  DIFFERENCE_KINDS,
  parseJudgeAnswer,
  QUESTION_IDS,
} from '../src/questions.js';

const input = {
  kind: 'path',
  itemTitle: '모바일 앱 폴더가 있어야 함',
  expected: '하네스/모바일',
  actual: 'ai/mobile',
};

describe('E.8 질문 템플릿', () => {
  it('세 질문: same_meaning(예/아니오) · difference_kind(4종) · plain_reason(한 문장)', () => {
    expect(QUESTION_IDS).toEqual(['same_meaning', 'difference_kind', 'plain_reason']);
    expect(DIFFERENCE_KINDS).toEqual(['equivalent', 'formatting-only', 'wrong-value', 'missing']);
    expect(answerJsonSchema()).toEqual({
      type: 'object',
      properties: {
        same_meaning: { type: 'string', enum: ['yes', 'no'] },
        difference_kind: {
          type: 'string',
          enum: ['equivalent', 'formatting-only', 'wrong-value', 'missing'],
        },
        plain_reason: { type: 'string', minLength: 1, maxLength: 300 },
      },
      required: ['same_meaning', 'difference_kind', 'plain_reason'],
      additionalProperties: false,
    });
  });

  it('요청 스냅샷 — 입력은 기대값·실제값·항목 제목·비교기 종류만', () => {
    const p = buildJudgePrompt(input);
    expect(p).toMatchSnapshot();
    const data = JSON.parse(p.user.slice(p.user.indexOf('{'), p.user.indexOf('}') + 1)) as Record<
      string,
      unknown
    >;
    expect(Object.keys(data).sort()).toEqual(['actual', 'comparator_kind', 'expected', 'item_title']);
  });

  it('질문 일부만 물으면 스키마도 그 질문만', () => {
    const p = buildJudgePrompt(input, ['same_meaning']);
    expect(p.schema.required).toEqual(['same_meaning']);
    expect(p.user).not.toContain('plain_reason');
  });

  it('답 검증: 형식 맞으면 통과, 빠지거나 틀리면 undefined (예외 없음)', () => {
    const ok = { same_meaning: 'yes', difference_kind: 'equivalent', plain_reason: '같은 폴더예요.' };
    expect(parseJudgeAnswer(ok)).toEqual(ok);
    expect(parseJudgeAnswer('```json\n' + JSON.stringify(ok) + '\n```')).toEqual(ok);
    expect(parseJudgeAnswer({ ...ok, same_meaning: true })).toEqual(ok);
    expect(parseJudgeAnswer({ ...ok, same_meaning: 'Yes' })).toEqual(ok);
    expect(parseJudgeAnswer({ ...ok, difference_kind: 'other' })).toBeUndefined();
    expect(parseJudgeAnswer({ same_meaning: 'yes' })).toBeUndefined();
    expect(parseJudgeAnswer('not json')).toBeUndefined();
    expect(parseJudgeAnswer(null)).toBeUndefined();
  });
});
