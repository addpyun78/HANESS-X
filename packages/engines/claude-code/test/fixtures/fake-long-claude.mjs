// 14.6 테스트용 가짜 claude: 손자 프로세스를 띄우고 init 한 줄을 낸 뒤 끝없이 대기한다.
// HX_PID_FILE에 "자식pid 손자pid"를 쓴다. HX_IGNORE_TERM=1이면 SIGTERM을 무시한다(SIGKILL 승격 확인용).
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

if (process.env.HX_IGNORE_TERM === '1') process.on('SIGTERM', () => {});
const grandchild = spawn(process.execPath, ['-e', 'process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'], {
  stdio: 'ignore',
});
writeFileSync(process.env.HX_PID_FILE, `${process.pid} ${grandchild.pid}`);
process.stdout.write(
  JSON.stringify({ type: 'system', subtype: 'init', session_id: 'fake-session-1' }) + '\n',
);
setInterval(() => {}, 1000);
