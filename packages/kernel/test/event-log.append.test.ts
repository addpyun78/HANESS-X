import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { EventLog } from '../src/event-log.js';
import { tempDir, textEvent } from './helpers.js';

describe('EventLog.append', () => {
  let cleanup = () => {};
  afterEach(() => cleanup());

  it('1,000개 쓰기 후 줄 수 일치', () => {
    const t = tempDir();
    cleanup = t.cleanup;
    const log = new EventLog({ root: t.dir });
    for (let i = 0; i < 1000; i++) log.append(textEvent('s1', `line ${i}\n줄바꿈 포함`));
    const lines = readFileSync(log.sessionFile('s1'), 'utf8').split('\n').filter(Boolean);
    expect(lines).toHaveLength(1000);
    for (const l of lines) expect(() => JSON.parse(l)).not.toThrow();
    log.close();
  });

  it('잘못된 HarnessEvent는 거부', () => {
    const t = tempDir();
    cleanup = t.cleanup;
    const log = new EventLog({ root: t.dir });
    expect(() => log.append({ ...textEvent('s1', 'x'), text: 1 as unknown as string })).toThrow();
    expect(() => log.append(textEvent('../evil', 'x'))).toThrow();
    log.close();
  });
});
