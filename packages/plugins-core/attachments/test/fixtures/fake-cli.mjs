// 가짜 엔진 CLI: 받은 인자를 HX_ARGV_OUT 파일에 JSON으로 남기고 바로 끝낸다 (첨부 전달 리플레이용)
import { appendFileSync } from 'node:fs';

const out = process.env.HX_ARGV_OUT;
if (out) appendFileSync(out, JSON.stringify(process.argv.slice(2)) + '\n');
process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', result: 'ok' }) + '\n');
