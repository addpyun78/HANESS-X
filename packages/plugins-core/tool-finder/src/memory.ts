import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { pureCandidate, ToolCandidateSchema, type ToolCandidate } from './candidate.js';
import { needKey } from './need.js';

/**
 * P3-C.7 선택 기록 — <home>/tools/choices.json
 * 같은 필요(능력 설명 열쇠)가 다시 나오면 이전에 고른 도구를 맨 위에 "지난번에 고른 도구"로 보여 준다.
 */

export const PREVIOUS_CHOICE_LABEL = '지난번에 고른 도구';

export function choicesFile(home: string): string {
  return join(home, 'tools', 'choices.json');
}

const ChoiceSchema = z.object({
  capability: z.string(),
  at: z.string(),
  candidates: z.array(ToolCandidateSchema),
});
const FileSchema = z.object({ version: z.literal(1), choices: z.record(z.string(), ChoiceSchema) });
type ChoicesFile = z.infer<typeof FileSchema>;

export class ChoiceMemory {
  readonly file: string;
  constructor(home: string) {
    this.file = choicesFile(home);
  }

  private read(): ChoicesFile {
    if (!existsSync(this.file)) return { version: 1, choices: {} };
    try {
      const r = FileSchema.safeParse(JSON.parse(readFileSync(this.file, 'utf8')));
      return r.success ? r.data : { version: 1, choices: {} };
    } catch {
      return { version: 1, choices: {} };
    }
  }

  record(capability: string, chosen: readonly ToolCandidate[], now = new Date()): void {
    if (chosen.length === 0) return;
    const f = this.read();
    // 화면용 덧붙임(이유·배지 등)은 빼고 후보 정보만 저장
    f.choices[needKey(capability)] = {
      capability,
      at: now.toISOString(),
      candidates: chosen.map(pureCandidate),
    };
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(f, null, 2) + '\n');
    renameSync(tmp, this.file);
  }

  previous(capability: string): ToolCandidate[] {
    return this.read().choices[needKey(capability)]?.candidates ?? [];
  }
}

/** 이전 선택을 맨 앞으로 (결과에 없으면 기록해 둔 후보를 넣는다). previous 표시 id 목록도 돌려준다 */
export function withPrevious(
  list: readonly ToolCandidate[],
  prev: readonly ToolCandidate[],
): { list: ToolCandidate[]; previousIds: string[] } {
  if (prev.length === 0) return { list: [...list], previousIds: [] };
  const ids = prev.map((p) => p.id);
  const front = prev.map((p) => list.find((c) => c.id === p.id) ?? p);
  return { list: [...front, ...list.filter((c) => !ids.includes(c.id))], previousIds: ids };
}
