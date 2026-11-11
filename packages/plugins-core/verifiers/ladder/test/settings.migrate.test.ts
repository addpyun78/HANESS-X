import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { judgeSettingsFrom, migrateVerifierConfig, type SettingsEventSink } from '../src/settings.js';

/** 삭제된 외부 판정 서비스의 예전 설정 값 — 조사 파일에서 읽는다(코드에 이름을 남기지 않는다, J.8) */
const SITES = fileURLToPath(new URL('../../../../../docs/tickets/T-100-jev-sites.md', import.meta.url));
const retired = /예전 설정 값·절 이름[^`]*`([^`]+)`/.exec(readFileSync(SITES, 'utf8'))![1]!;

function sink() {
  const events: Record<string, unknown>[] = [];
  const log: SettingsEventSink = { append: (e) => events.push(e) };
  return { log, events };
}
const T = () => new Date('2026-11-11T00:00:00.000Z');

describe('J.5 설정 마이그레이션 verifier.l4 → judge.* (4케이스)', () => {
  it.each([
    [retired, { 'judge.engine': '' }],
    ['local', { 'judge.engine': '' }],
    ['engine', { 'judge.engine': '' }],
    ['off', { 'judge.semantic': 'off' }],
  ])('verifier.l4 = %s', (value, to) => {
    const { log, events } = sink();
    const before = { verifier: { l4: value }, judge: { samples: 3 }, other: 1 };
    const r = migrateVerifierConfig(before, { log, now: T, idGen: () => 'ev1' });
    expect(r.migrated).toBe(true);
    expect(before.verifier.l4).toBe(value); // 입력은 그대로
    expect(r.config).toEqual({
      other: 1,
      judge: value === 'off' ? { samples: 3, semantic: 'off' } : { samples: 3, engine: '' },
    });
    expect(judgeSettingsFrom(r.config)).toMatchObject(value === 'off' ? { semantic: 'off' } : { engine: '' });
    expect(events).toEqual([
      {
        id: 'ev1',
        ts: '2026-11-11T00:00:00.000Z',
        sessionId: 'harness-system',
        type: 'config_migrated',
        key: 'verifier.l4',
        from: value,
        to,
        removed: ['verifier.l4'],
      },
    ]);
    expect(r.retired).toEqual(value === retired ? [retired] : []);
  });

  it('삭제된 서비스 설정 절도 지우고(로컬 판정기 설정은 유지), 평면 키도 옮긴다', () => {
    const r = migrateVerifierConfig({
      verifier: { l4: retired, [retired]: { endpoint: 'https://x', apiKeyEnv: 'K' }, local: { model: 'q' } },
    });
    expect(r.config).toEqual({ verifier: { local: { model: 'q' } }, judge: { engine: '' } });
    expect(r.event?.removed).toEqual(['verifier.l4', `verifier.${retired}`]);
    expect(r.retired).toEqual([retired]);
    expect(migrateVerifierConfig({ 'verifier.l4': 'off' }).config).toEqual({ judge: { semantic: 'off' } });
  });

  it('옮길 것이 없으면 그대로, 이벤트 없음', () => {
    const { log, events } = sink();
    const cfg = { judge: { engine: 'codex' } };
    expect(migrateVerifierConfig(cfg, { log })).toEqual({ config: cfg, migrated: false, retired: [] });
    expect(events).toEqual([]);
  });
});
