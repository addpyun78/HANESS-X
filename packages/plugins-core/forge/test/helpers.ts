import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventLog } from '@harness-x/kernel';
import type { EngineRun, HarnessEvent } from '@harness-x/protocol';
import { ForgeBroker, type ForgeCard } from '../src/broker.js';
import type { ForgeAnswer } from '../src/interview.js';

/** Forge 테스트 공용: 임시 폴더 + 이벤트 로그 + 브로커 */
export function forgeEnv(prefix = 'hx-forge-') {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  const log = new EventLog({ root: join(dir, 'logs') });
  const broker = new ForgeBroker({ log });
  return {
    dir,
    workspace: join(dir, 'ws'),
    home: join(dir, 'home'),
    log,
    broker,
    cleanup: () => {
      log.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** 카드마다 제안 답(없으면 첫 선택지)으로 자동 응답. pick으로 바꿀 수 있다 */
export function autoAnswer(
  broker: ForgeBroker,
  pick: (card: ForgeCard) => ForgeAnswer | undefined = () => undefined,
): { cards: ForgeCard[]; stop: () => void } {
  const cards: ForgeCard[] = [];
  const stop = broker.onCard((card) => {
    cards.push(card);
    queueMicrotask(() => {
      const chosen = pick(card) ?? defaultAnswer(card);
      broker.answer(card.approvalId, chosen);
    });
  });
  return { cards, stop };
}

export function defaultAnswer(card: ForgeCard): ForgeAnswer {
  if (card.kind === 'forge_spec') return { value: 'confirm' };
  if (card.kind === 'forge_install') return { value: 'install' };
  const s = card.detail?.suggested as string | string[] | undefined;
  return { value: s ?? card.options[0]! };
}

export async function collect(run: EngineRun): Promise<HarnessEvent[]> {
  const out: HarnessEvent[] = [];
  for await (const e of run.events) out.push(e);
  return out;
}
