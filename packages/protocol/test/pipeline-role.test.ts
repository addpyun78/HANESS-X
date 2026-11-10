import { describe, expect, it } from 'vitest';
import { RoleNodeSchema } from '../src/pipeline.js';

describe('40.2 role 노드 필드', () => {
  it('전체 필드 통과', () => {
    const node = RoleNodeSchema.parse({
      id: 'build',
      type: 'role',
      label: '구현',
      engine: 'codex',
      mode: 'apiKey',
      skills: ['frontend-design', 'a11y-check'],
      tools: ['shell', 'fs'],
      permission: 'workspace-write',
      checklistTemplate: 'templates/build.md',
      inputSchema: { type: 'object', properties: { plan: { type: 'string' } }, required: ['plan'] },
      outputSchema: { type: 'object', properties: { files: { type: 'array' } } },
    });
    expect(node.engine).toBe('codex');
    expect(node.skills).toEqual(['frontend-design', 'a11y-check']);
    expect(node.inputSchema).toMatchObject({ required: ['plan'] });
  });

  it('기본값: engine auto, mode subscription, 빈 skills/tools, workspace-write', () => {
    expect(RoleNodeSchema.parse({ id: 'plan', type: 'role' })).toEqual({
      id: 'plan',
      type: 'role',
      engine: 'auto',
      mode: 'subscription',
      skills: [],
      tools: [],
      permission: 'workspace-write',
    });
  });

  it('잘못된 값 거부', () => {
    const bad = [
      { engine: 'Claude Code' },
      { engine: '' },
      { mode: 'oauth' },
      { permission: 'root' },
      { skills: [''] },
      { tools: 'shell' },
      { inputSchema: 'string' },
      { checklistTemplate: '' },
    ];
    for (const b of bad) {
      expect(RoleNodeSchema.safeParse({ id: 'x', type: 'role', ...b }).success, JSON.stringify(b)).toBe(
        false,
      );
    }
  });
});
