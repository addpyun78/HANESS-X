import { afterEach, describe, expect, it } from 'vitest';
import { buildInventory } from '@harness-x/agent-builder';
import { type InstallPlan } from '../src/index.js';
import { WINGET_SHOW_JQ, approval, service, tempHome } from './helpers.js';

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((f) => f()));

const JQ = {
  'winget show --id jqlang.jq': { stdout: WINGET_SHOW_JQ },
  'winget install --id jqlang.jq': { stdout: 'Successfully installed' },
  'winget list --id jqlang.jq': { stdout: 'jq jqlang.jq 1.7.1' },
  'powershell.exe -NoProfile -Command': {
    stdout: 'C:\\Users\\u\\AppData\\Local\\Microsoft\\WinGet\\Links\\jq.exe',
  },
  'winget uninstall --id jqlang.jq': { stdout: 'Successfully uninstalled' },
};

describe('P2-F.7 도구 목록(레지스트리)은 Part 4 인벤토리(자산 전수조사)에 포함', () => {
  it('설치하면 인벤토리 도구에 무료/유료와 함께 나타나고, 지우면 빠진다', async () => {
    const h = tempHome();
    cleanups.push(h.cleanup);
    const { svc } = service(h.dir, JQ);
    expect((await buildInventory({ home: h.dir })).tools.filter((t) => t.source === 'registry')).toEqual([]);
    const p = (await svc.plan({ kind: 'winget', target: { id: 'jqlang.jq' } })) as InstallPlan;
    expect((await svc.execute(p.id, approval).done).status).toBe('installed');
    const inv = await buildInventory({ home: h.dir });
    const jq = inv.tools.find((t) => t.id === 'winget:jqlang.jq');
    expect(jq).toMatchObject({
      name: 'jq',
      kind: 'winget',
      version: '1.7.1',
      pricing: 'free',
      pricingTier: 'free',
      source: 'registry',
      health: 'ready',
    });
    expect(jq!.purpose).toContain('jq');
    expect(jq!.capabilities.length).toBeGreaterThan(0);
    // 등급을 모르는(무료+유료 기능 등) 도구는 free/paid로 단정하지 않고, 원래 등급을 함께 싣는다
    svc.registry.upsert({
      ...svc.registry.get('winget:jqlang.jq')!,
      id: 'npm-cli:x',
      name: 'x',
      kind: 'npm-cli',
      pricing: { tier: 'freemium', note: '', checkedAt: '', sourceUrl: '' },
    });
    const x = (await buildInventory({ home: h.dir })).tools.find((t) => t.id === 'npm-cli:x');
    expect(x).toMatchObject({ pricing: 'unknown', pricingTier: 'freemium' });
    await svc.execute(svc.uninstallPlan('winget:jqlang.jq').id, approval).done;
    expect((await buildInventory({ home: h.dir })).tools.map((t) => t.id)).not.toContain('winget:jqlang.jq');
  });
});
