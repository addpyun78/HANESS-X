// 테스트용 가짜 agy: argv를 HX_FAKE_LOG에 기록하고, HX_FAKE_STDOUT/HX_FAKE_STDERR 파일 내용을 출력한 뒤
// HX_FAKE_EXIT 코드로 종료한다.
import { appendFileSync, readFileSync } from 'node:fs';

const env = process.env;
if (env.HX_FAKE_LOG) appendFileSync(env.HX_FAKE_LOG, JSON.stringify(process.argv.slice(2)) + '\n');
if (env.HX_FAKE_STDERR) process.stderr.write(readFileSync(env.HX_FAKE_STDERR, 'utf8'));
const out = env.HX_FAKE_STDOUT ? readFileSync(env.HX_FAKE_STDOUT, 'utf8') : '';
process.stdout.write(out, () => process.exit(Number(env.HX_FAKE_EXIT ?? 0)));
