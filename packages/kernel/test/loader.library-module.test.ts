// T-102 E.C2-001.1 재현: activate가 없는 플러그인(함수만 내보내는 라이브러리형, 예: checklist-ledger)도
// 로드 뒤 loader.plugins.get(id).module 에 내보낸 함수가 남아 있어야 한다(커널이 그 함수로 서버 주소를 연결함)
import { afterEach, describe, expect, it } from 'vitest';
import { makePlugin, setup } from './plugin-fixtures.js';

describe('activate 없는 플러그인 모듈 보존 (T-102 C2-001)', () => {
  let env: ReturnType<typeof setup>;
  afterEach(() => env.cleanup());

  it('activate 없이 함수만 내보내도 module에 그 함수가 있다', async () => {
    env = setup();
    makePlugin(
      env.wsRoot,
      { id: 'lib-only', version: '1.0.0', apiVersion: 1, main: 'index.js', provides: { tool: ['lib-only'] } },
      'export function registerThing(){ return "ok"; }\nexport const VALUE = 7;',
    );
    const loader = env.mk();
    expect(await loader.loadAll()).toEqual(['lib-only']);
    const m = loader.plugins.get('lib-only')?.module as { registerThing?: () => string; VALUE?: number };
    expect(typeof m?.registerThing).toBe('function');
    expect(m.registerThing!()).toBe('ok');
    expect(m.VALUE).toBe(7);
  });

  it('default 내보내기만 있으면 기존처럼 default를 쓴다', async () => {
    env = setup();
    makePlugin(
      env.wsRoot,
      { id: 'def-only', version: '1.0.0', apiVersion: 1, main: 'index.js', provides: { tool: ['def-only'] } },
      'export default { activate(){}, hello: 1 };',
    );
    const loader = env.mk();
    expect(await loader.loadAll()).toEqual(['def-only']);
    expect((loader.plugins.get('def-only')?.module as { hello?: number }).hello).toBe(1);
  });
});
