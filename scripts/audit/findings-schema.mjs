// C.3 findings.json 스키마(Zod)
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { root } from './lib.mjs';
const require = createRequire(join(root, 'packages', 'protocol', 'package.json'));
const { z } = require('zod');

export const AREAS = [
  'bug',
  'shell',
  'security',
  'size',
  'unused',
  'consolidation',
  'update',
  'docs',
  'structure',
];
export const Finding = z
  .object({
    id: z.string().regex(/^C\d-\d{3}$/),
    area: z.enum(AREAS),
    severity: z.enum(['critical', 'high', 'medium', 'low']),
    title: z.string().min(3),
    evidence: z.array(z.string()).min(1),
    features: z.array(z.string().regex(/^F-\d{3}$/)),
    proposal: z.string().min(3),
    risk: z.enum(['low', 'medium', 'high']),
    effort: z.enum(['S', 'M', 'L']),
    status: z
      .string()
      .regex(/^(open|fixed|implemented|hidden|merged|deleted|보류: .+|merged-into: C\d-\d{3})$/),
    // D 단계에서 채우는 칸(선택)
    plain: z.string().optional(),
    decision: z.enum(['fix', 'implement', 'hide', 'hold']).optional(),
    decisionReason: z.string().optional(),
    bundle: z.enum(['must', 'nice', 'hold']).optional(),
    meta: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export const Findings = z.object({ findings: z.array(Finding) }).strict();

export function validate(doc) {
  const r = Findings.safeParse(doc);
  if (r.success) {
    const ids = new Set();
    for (const f of doc.findings) {
      if (ids.has(f.id)) return { ok: false, errors: [`id 중복: ${f.id}`] };
      ids.add(f.id);
    }
    return { ok: true, errors: [] };
  }
  return { ok: false, errors: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) };
}
