import { describe, expect, it } from 'vitest';
import { PermissionsSchema } from '../src/manifest.js';

describe('권한 스키마', () => {
  it('정상 권한', () => {
    expect(
      PermissionsSchema.safeParse({ fs: ['workspace:read'], net: ['api.openai.com'], shell: false }).success,
    ).toBe(true);
  });
  it.each([
    ['fs 범위 밖', { fs: ['root:write'] }],
    ['fs 오타', { fs: ['workspace:rw'] }],
    ['fs 전체 경로', { fs: ['/etc'] }],
    ['net URL', { net: ['https://api.example.com'] }],
    ['net 경로 포함', { net: ['example.com/path'] }],
    ['net 와일드카드 전체', { net: ['*'] }],
    ['shell 문자열', { shell: 'yes' }],
    ['모르는 권한 키', { gpu: true }],
  ])('거부: %s', (_n, p) => {
    expect(PermissionsSchema.safeParse(p).success).toBe(false);
  });
});
