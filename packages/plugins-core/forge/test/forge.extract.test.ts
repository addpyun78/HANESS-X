import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ChecklistLedger } from '@harness-x/checklist-ledger';
import { validateSkillMd } from '@harness-x/sdk';
import { extractSkill, generalizeCommand, loadSessionMaterial } from '../src/extract.js';
import { forgeEnv } from './helpers.js';

const S = 's-done';

/** 샘플 완료 세션: 컴포넌트 3개에 테스트 쓰기 + 스냅샷 갱신 */
function sampleSession(env: ReturnType<typeof forgeEnv>) {
  const ledger = new ChecklistLedger({ dir: join(env.workspace, '.harness-x', 'sessions', S), sessionId: S });
  const comp = (name: string, k: number) => ({
    id: `t${k}`,
    title: `${name} 컴포넌트 테스트 작성`,
    artifactId: `test.${name.toLowerCase()}`,
    acceptance: [{ type: 'test' as const, run: `pnpm vitest run src/${name}.test.tsx` }],
  });
  ledger.create([
    comp('Header', 1),
    comp('Footer', 2),
    comp('Sidebar', 3),
    {
      id: 's1',
      title: '스토리북 스냅샷 갱신',
      artifactId: 'storybook.snapshots',
      acceptance: [{ type: 'file_exists', file: '__snapshots__' }],
    },
  ]);
  for (const id of ['t1', 't2', 't3', 's1']) {
    ledger.transition(id, 'doing');
    ledger.transition(id, 'verifying', { evidence: { kind: 'test', summary: 'ok' } });
    ledger.transition(id, 'done');
  }
  let n = 0;
  const call = (command: string) =>
    env.log.append({
      id: `e${++n}`,
      ts: new Date(Date.UTC(2026, 10, 11, 0, 0, n)).toISOString(),
      sessionId: S,
      type: 'tool_call',
      callId: `c${n}`,
      tool: 'Bash',
      input: { command },
    });
  for (const c of ['Header', 'Footer', 'Sidebar']) call(`pnpm vitest run src/${c}.test.tsx`);
  call('pnpm lint');
  call('git status');
  call('pnpm lint');
  env.log.flush();
}

describe('53.1 완료 세션의 체크리스트·궤적 → SKILL.md', () => {
  let env: ReturnType<typeof forgeEnv>;
  afterEach(() => env.cleanup());

  it('반복 단계·명령·검증을 일반화한 SKILL.md (프런트매터 검증 통과)', () => {
    env = forgeEnv();
    sampleSession(env);
    const m = loadSessionMaterial(env.workspace, S, env.log, '컴포넌트마다 테스트 쓰기');
    expect(m.items).toHaveLength(4);
    const skill = extractSkill(m, { name: 'Component Tests' });
    expect(skill.name).toBe('component-tests');
    expect(skill.steps.map((s) => [s.title, s.count])).toEqual([
      ['<…> 컴포넌트 테스트 작성', 3],
      ['스토리북 스냅샷 갱신', 1],
    ]);
    expect(skill.commands).toEqual([
      { command: 'pnpm vitest run <path>', count: 3 },
      { command: 'pnpm lint', count: 2 },
    ]);
    expect(skill.verifications).toEqual([
      '`pnpm vitest run <path>` 종료코드 0',
      '산출물 파일 존재: __snapshots__',
    ]);
    const v = validateSkillMd(skill.markdown);
    expect(v.ok).toBe(true);
    expect(v.frontmatter).toMatchObject({ name: 'component-tests' });
    expect(skill.markdown).toMatchSnapshot();
  });

  it('명령 일반화', () => {
    env = forgeEnv();
    expect(generalizeCommand('npx eslint src/a.ts --fix')).toBe('npx eslint <path> --fix');
    expect(generalizeCommand('git log -n 5')).toBe('git log -n <n>');
  });
});
