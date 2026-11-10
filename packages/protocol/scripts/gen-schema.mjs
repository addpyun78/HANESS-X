// Zod → JSON Schema 생성: packages/protocol/schemas/events.schema.json
// 실행: pnpm --filter @harness-x/protocol gen:schema (build 후)
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { HarnessEventSchema } from '../dist/events.js';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'schemas', 'events.schema.json');
const schema = z.toJSONSchema(HarnessEventSchema, { target: 'draft-2020-12' });
schema.$id = 'https://harness-x.local/schemas/events.schema.json';
schema.title = 'HarnessEvent';
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(schema, null, 2) + '\n');
console.log(`wrote ${out}`);
