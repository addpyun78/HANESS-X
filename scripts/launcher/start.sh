#!/bin/bash
# HARNESS-X 실행기 (WSL): 서버 + 웹 화면을 켜고 Windows 브라우저로 연다.
# 바탕화면 바로가기 → start-harness.cmd → 이 스크립트
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
source scripts/dev/env.sh
HOME_DIR="${HARNESS_X_HOME:-$HOME/.harness-x}"
RUN="$HOME_DIR/run"
mkdir -p "$RUN"
API=http://127.0.0.1:3790
WEB=http://127.0.0.1:5173

say() { printf '\033[1;36m[HARNESS-X]\033[0m %s\n' "$*"; }
# T-102 I.2: 401·404도 "켜짐"으로 보던 문제 → -f(성공 응답만)
api_up() { [ -f "$RUN/token" ] && curl -sf -o /dev/null -m 2 -H "authorization: Bearer $(cat "$RUN/token")" "$API/api/health"; }
web_up() { curl -sf -o /dev/null -m 2 "$WEB/"; }
# 기다리기: 최대 MAX초(WSL /mnt/c 위에서는 서버 기동이 1~3분 걸림), 프로세스가 죽으면 바로 멈추고 로그 끝을 보여 줌
wait_for() {
  local what=$1 fn=$2 pidfile=$3 max=${4:-300} n=0
  while ! $fn; do
    n=$((n+1))
    if [ -f "$pidfile" ] && ! kill -0 "$(cat "$pidfile")" 2>/dev/null; then
      say "$what 이(가) 켜지다가 멈췄어요. 로그 끝부분:"; tail -n 15 "$RUN/server.log" 2>/dev/null; return 1
    fi
    [ $n -gt "$max" ] && { say "$what 기동 시간 초과 ${max}초 (로그: $RUN)"; return 1; }
    [ $((n % 15)) -eq 0 ] && say "$what 켜는 중... ${n}초"
    sleep 1
  done
}

# 1) 빌드 산출물 확인
if [ ! -f packages/kernel/dist/cli.js ]; then
  say "처음 실행: 빌드 중..."
  pnpm install >/dev/null 2>&1
  pnpm -r --filter '!@harness-x/web' build >"$RUN/build.log" 2>&1 || { say "빌드 실패 (로그: $RUN/build.log)"; exit 1; }
fi

# 1-2) 이 저장소의 기본 플러그인(packages/plugins-core) 지문을 새로 고친다.
#      코드를 업데이트하면 지문이 바뀌어 "plugins.lock 불일치: 파일이 변조됨"으로 막히기 때문.
#      사용자가 따로 설치한 플러그인(저장소 밖)의 변조 검사는 그대로 유지된다.
node --no-warnings -e '
const { readFileSync, readdirSync, existsSync } = require("node:fs");
const { join } = require("node:path");
const [root, lock] = process.argv.slice(1);
const ids = [];
const base = join(root, "packages", "plugins-core");
const walk = (d, depth) => { for (const n of readdirSync(d, { withFileTypes: true })) {
  if (!n.isDirectory() || n.name === "node_modules") continue;
  const m = join(d, n.name, "harness-plugin.json");
  if (existsSync(m)) ids.push(JSON.parse(readFileSync(m, "utf8")).id);
  else if (depth < 1) walk(join(d, n.name), depth + 1);
} };
walk(base, 0);
import(join(root, "packages/kernel/dist/index.js")).then((k) => {
  const removed = existsSync(lock) ? k.removeLockEntries(lock, ids) : [];
  if (removed.length) console.log("기본 플러그인 지문 새로 고침: " + removed.join(", "));
});
' "$ROOT" "$HOME_DIR/plugins.lock" 2>>"$RUN/server.log" | while read -r l; do say "$l"; done

# 2) 토큰을 먼저 정한다 — 화면을 서버보다 먼저 열 수 있게(T-102 I.2). 서버에는 같은 값을 HARNESS_X_TOKEN으로 넘긴다
if [ ! -s "$RUN/token" ] || [ "$(wc -c <"$RUN/token")" -lt 33 ]; then
  node -e 'process.stdout.write(require("node:crypto").randomBytes(24).toString("hex"))' >"$RUN/token.tmp" && mv "$RUN/token.tmp" "$RUN/token"
  chmod 600 "$RUN/token"
fi
TOKEN=$(cat "$RUN/token")
# T-102 I.2.launch-feedback 바로가기(VBS)가 다음번에 "켜는 중" 화면에서 바로 하네스 화면으로 넘어가도록 토큰 사본을 Windows 쪽에 둔다
# (HX_WIN_TOKEN = %LOCALAPPDATA%\harness-x\token, 그 사용자만 읽을 수 있는 폴더)
if [ -n "${HX_WIN_TOKEN:-}" ] && [ "$(cat "$HX_WIN_TOKEN" 2>/dev/null)" != "$TOKEN" ]; then
  printf '%s' "$TOKEN" >"$HX_WIN_TOKEN" 2>/dev/null || true
fi

# 3) 웹 화면(2~3초) — 먼저 켜서 바로 보이게
if [ ! -f apps/web/package.json ]; then
  say "웹 화면(apps/web)이 없습니다."
  exit 2
fi
if web_up; then
  say "웹 화면 실행 중 ($WEB)"
else
  say "웹 화면 시작 중..."
  setsid -f bash -c 'echo $$ >"$0/web.pid"; cd "$1/apps/web" && exec ./node_modules/.bin/vite --host 127.0.0.1 --port 5173 --strictPort >"$0/web.log" 2>&1 </dev/null' "$RUN" "$ROOT"
  wait_for "웹 화면" web_up "$RUN/web.pid" 120 || exit 1
fi

# 4) 브라우저를 바로 연다 — 하네스 서버가 아직이면 화면이 "켜는 중"을 보여 주고 준비되면 저절로 불러온다
#    (토큰은 주소로 전달 → 화면이 세션 저장소로 옮기고 주소창에서 지움). explorer.exe는 검은 창을 띄우지 않는다
if [ -n "${HX_NO_BROWSER:-}" ]; then
  say "준비됨: $WEB/?token=… (HX_NO_BROWSER)"
else
  say "브라우저를 엽니다"
  explorer.exe "$WEB/?token=$TOKEN" >/dev/null 2>&1 || cmd.exe /c start "" "$WEB/?token=$TOKEN" >/dev/null 2>&1
fi

# 5) 하네스 서버
if api_up; then
  say "하네스 서버 실행 중 ($API)"
else
  say "하네스 서버 시작 중... (WSL에서 C: 드라이브 위라 1~3분 걸릴 수 있어요)"
  # 지난 로그 보관(켤 때마다 덮어써서 죽은 원인이 사라지던 문제)
  [ -f "$RUN/server.log" ] && mv -f "$RUN/server.log" "$RUN/server.log.1"
  # setsid: 바로가기 창(wsl.exe)이 닫혀도 프로세스가 같이 죽지 않게 새 세션으로 분리
  HARNESS_X_TOKEN="$TOKEN" setsid -f bash -c 'echo $$ >"$0/server.pid"; exec node --no-warnings packages/kernel/dist/cli.js serve --workspace "$1" >"$0/server.out" 2>"$0/server.log" </dev/null' "$RUN" "$ROOT"
  sleep 2
  wait_for "하네스 서버" api_up "$RUN/server.pid" 300 || exit 1
  say "하네스 서버 준비 ($API)"
fi
exit 0
