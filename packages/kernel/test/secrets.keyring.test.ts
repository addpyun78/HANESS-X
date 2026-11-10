import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { keyringBackend, memoryBackend, SecretStore, type SecretBackend } from '../src/secrets.js';

function roundTrip(backend: SecretBackend) {
  // 테스트 전용 서비스 이름 + 임의 계정: 사용자의 실제 항목과 겹치지 않는다
  const store = new SecretStore(backend, 'harness-x-test');
  const account = `test-${process.pid}-${randomBytes(4).toString('hex')}`;
  const value = `test-value-${randomBytes(8).toString('hex')}`;
  try {
    expect(store.get(account)).toBeNull();
    store.set(account, value);
    expect(store.get(account)).toBe(value);
    expect(store.has(account)).toBe(true);
    expect(store.delete(account)).toBe(true);
    expect(store.get(account)).toBeNull();
    expect(store.delete(account)).toBe(false);
  } finally {
    backend.delete('harness-x-test', account);
  }
}

describe('13.1 OS 키체인 저장/조회/삭제', () => {
  it('실제 OS 키체인(@napi-rs/keyring): 저장 후 조회 일치, 삭제 후 없음', () => {
    roundTrip(keyringBackend());
  });

  it('메모리 백엔드도 같은 계약', () => {
    roundTrip(memoryBackend());
  });

  it('빈 값 저장 거부', () => {
    expect(() => new SecretStore(memoryBackend()).set('a', '')).toThrow();
  });
});
