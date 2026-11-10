// T-064 64.3 테스트용 가짜 claude (`claude -p --output-format stream-json` 흉내). 실제 CLI·API는 부르지 않는다.
// 구독 한도를 흉내 낸다: HX_FAKE_CLAUDE_BUDGET 파일의 숫자만큼 성공 턴(HX_FAKE_CLAUDE_OK 녹화)을 내고,
// 0이 되면 한도 초과 턴(HX_FAKE_CLAUDE_LIMIT 녹화)을 낸다. HX_FAKE_LOG에 argv를 줄마다 기록한다.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';

const env = process.env;
if (env.HX_FAKE_LOG) appendFileSync(env.HX_FAKE_LOG, JSON.stringify({ argv: process.argv.slice(2) }) + '\n');
const budget = Number(readFileSync(env.HX_FAKE_CLAUDE_BUDGET, 'utf8').trim()) || 0;
if (budget > 0) writeFileSync(env.HX_FAKE_CLAUDE_BUDGET, String(budget - 1));
const replay = readFileSync(budget > 0 ? env.HX_FAKE_CLAUDE_OK : env.HX_FAKE_CLAUDE_LIMIT, 'utf8');
process.stdout.write(replay, () => process.exit(0));
