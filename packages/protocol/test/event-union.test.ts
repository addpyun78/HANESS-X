import { describe, expectTypeOf, it } from 'vitest';
import type {
  HarnessEvent,
  HarnessEventType,
  AssistantTextEvent,
  ToolCallEvent,
  ToolResultEvent,
  FileChangeEvent,
  UsageEvent,
  ErrorEvent,
  TurnEndEvent,
  ApprovalRequestEvent,
  ChecklistChangeEvent,
  EventBase,
} from '../src/events.js';

type Of<T extends HarnessEventType> = Extract<HarnessEvent, { type: T }>;

describe('HarnessEvent 유니온 9종', () => {
  it('타입 집합', () => {
    expectTypeOf<HarnessEventType>().toEqualTypeOf<
      | 'assistant_text'
      | 'tool_call'
      | 'tool_result'
      | 'file_change'
      | 'usage'
      | 'error'
      | 'turn_end'
      | 'approval_request'
      | 'checklist_change'
    >();
  });
  it('assistant_text', () => {
    expectTypeOf<Of<'assistant_text'>>().toEqualTypeOf<AssistantTextEvent>();
    expectTypeOf<AssistantTextEvent['text']>().toEqualTypeOf<string>();
    expectTypeOf<AssistantTextEvent>().toExtend<EventBase>();
  });
  it('tool_call', () => {
    expectTypeOf<Of<'tool_call'>>().toEqualTypeOf<ToolCallEvent>();
    expectTypeOf<ToolCallEvent['tool']>().toEqualTypeOf<string>();
  });
  it('tool_result', () => {
    expectTypeOf<Of<'tool_result'>>().toEqualTypeOf<ToolResultEvent>();
    expectTypeOf<ToolResultEvent['ok']>().toEqualTypeOf<boolean>();
  });
  it('file_change', () => {
    expectTypeOf<Of<'file_change'>>().toEqualTypeOf<FileChangeEvent>();
    expectTypeOf<FileChangeEvent['change']>().toEqualTypeOf<'create' | 'modify' | 'delete' | 'rename'>();
  });
  it('usage', () => {
    expectTypeOf<Of<'usage'>>().toEqualTypeOf<UsageEvent>();
    expectTypeOf<UsageEvent['inputTokens']>().toEqualTypeOf<number>();
  });
  it('error', () => {
    expectTypeOf<Of<'error'>>().toEqualTypeOf<ErrorEvent>();
    expectTypeOf<ErrorEvent['code']>().toEqualTypeOf<string>();
  });
  it('turn_end', () => {
    expectTypeOf<Of<'turn_end'>>().toEqualTypeOf<TurnEndEvent>();
    expectTypeOf<TurnEndEvent['reason']>().toEqualTypeOf<
      'completed' | 'interrupted' | 'error' | 'max_turns' | 'blocked'
    >();
  });
  it('approval_request', () => {
    expectTypeOf<Of<'approval_request'>>().toEqualTypeOf<ApprovalRequestEvent>();
    expectTypeOf<ApprovalRequestEvent['options']>().toEqualTypeOf<string[]>();
  });
  it('checklist_change', () => {
    expectTypeOf<Of<'checklist_change'>>().toEqualTypeOf<ChecklistChangeEvent>();
    expectTypeOf<ChecklistChangeEvent['version']>().toEqualTypeOf<number>();
  });
});
