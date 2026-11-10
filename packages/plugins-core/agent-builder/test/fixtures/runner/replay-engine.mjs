// 테스트용 리플레이 엔진 바이너리 (claude/codex 대역).
// usage: node replay-engine.mjs <녹화 JSONL> <argv 기록 파일> ...엔진 인자
// 받은 엔진 인자(프롬프트 포함)와 HARNESS_X_* 환경변수를 기록 파일에 한 줄로 남기고, 녹화본을 그대로 출력한다.
import { appendFileSync, readFileSync } from 'node:fs';

const [fixture, logFile, ...args] = process.argv.slice(2);
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith('HARNESS_X_')));
appendFileSync(logFile, JSON.stringify({ args, env }) + '\n');
process.stdout.write(readFileSync(fixture, 'utf8'), () => process.exit(0));
