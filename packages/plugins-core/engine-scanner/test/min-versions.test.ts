import { describe, expect, it } from 'vitest';
import semver from 'semver';
import { compareToMinimum, ENGINE_TARGETS, MIN_VERSIONS, normalizeVersion } from '@harness-x/engine-scanner';

describe('10.4 최소 지원 버전 비교', () => {
  it('모든 대상에 유효한 semver 최소 버전이 있다', () => {
    for (const t of ENGINE_TARGETS) expect(semver.valid(MIN_VERSIONS[t]), t).not.toBeNull();
  });

  it('낮은 버전은 outdated, 같거나 높으면 ok', () => {
    expect(compareToMinimum('claude', '1.0.99')).toEqual({ status: 'outdated', minVersion: '2.0.0' });
    expect(compareToMinimum('claude', '2.0.0').status).toBe('ok');
    expect(compareToMinimum('codex', '0.39.9').status).toBe('outdated');
    expect(compareToMinimum('codex', '0.46.0').status).toBe('ok');
    expect(compareToMinimum('cursor-agent', '2025.07.30-abc').status).toBe('outdated');
    expect(compareToMinimum('cursor-agent', '2025.09.18-7ae6800').status).toBe('ok');
  });

  it('버전을 모르면 unknown, 표에 없는 이름은 ok', () => {
    expect(compareToMinimum('agy', null)).toEqual({ status: 'unknown', minVersion: '1.0.0' });
    expect(compareToMinimum('other', '0.0.1')).toEqual({ status: 'ok' });
    expect(compareToMinimum('x', '1.0.0', { x: '2.0.0' }).status).toBe('outdated');
  });

  it('느슨한 버전 정규화', () => {
    expect(normalizeVersion('1.12.0')).toBe('1.12.0');
    expect(normalizeVersion('2025.09.18')).toBe('2025.9.18');
    expect(normalizeVersion('garbage')).toBeNull();
  });
});
