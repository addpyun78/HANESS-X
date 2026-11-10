// 테스트용 리플레이 엔진 바이너리 (claude/codex 대역).
// usage: node replay-engine.mjs <녹화 JSONL[,두번째,…]> <argv 기록 파일> ...엔진 인자
// 받은 엔진 인자(프롬프트 포함)와 HARNESS_X_* 환경변수를 기록 파일에 한 줄로 남기고, 녹화본을 그대로 출력한다.
// 녹화본을 쉼표로 여러 개 주면 n번째 호출에 n번째 녹화본을 쓴다(마지막 것은 반복).
import { appendFileSync, existsSync, readFileSync } from 'node:fs';

const [fixtures, logFile, ...args] = process.argv.slice(2);
const list = fixtures.split(',');
const n = existsSync(logFile) ? readFileSync(logFile, 'utf8').split('\n').filter(Boolean).length : 0;
const fixture = list[Math.min(n, list.length - 1)];
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith('HARNESS_X_')));
appendFileSync(logFile, JSON.stringify({ args, env }) + '\n');
process.stdout.write(readFileSync(fixture, 'utf8'), () => process.exit(0));
