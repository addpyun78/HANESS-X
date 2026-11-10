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
api_up() { [ -f "$RUN/token" ] && curl -s -o /dev/null -m 2 -H "authorization: Bearer $(cat "$RUN/token")" "$API/api/health"; }
web_up() { curl -s -o /dev/null -m 2 "$WEB/"; }
wait_for() { local what=$1 fn=$2 n=0; while ! $fn; do n=$((n+1)); [ $n -gt 120 ] && { say "$what 기동 시간 초과 (로그: $RUN)"; return 1; }; sleep 1; done; }

# 1) 빌드 산출물 확인
if [ ! -f packages/kernel/dist/cli.js ]; then
  say "처음 실행: 빌드 중..."
  pnpm install >/dev/null 2>&1
  pnpm -r --filter '!@harness-x/web' build >"$RUN/build.log" 2>&1 || { say "빌드 실패 (로그: $RUN/build.log)"; exit 1; }
fi

# 2) 하네스 서버
if api_up; then
  say "하네스 서버 실행 중 ($API)"
else
  say "하네스 서버 시작 중... (WSL에서 C: 드라이브 위라 10~20초 걸릴 수 있음)"
  # setsid: 바로가기 창(wsl.exe)이 닫혀도 프로세스가 같이 죽지 않게 새 세션으로 분리
  setsid -f bash -c 'echo $$ >"$0/server.pid"; exec node --no-warnings packages/kernel/dist/cli.js serve --workspace "$1" >"$0/server.out" 2>"$0/server.log" </dev/null' "$RUN" "$ROOT"
  sleep 2
  wait_for "서버" api_up || exit 1
  say "하네스 서버 준비 ($API)"
fi
TOKEN=$(cat "$RUN/token")

# 3) 웹 화면
if [ ! -f apps/web/package.json ]; then
  say "웹 화면(apps/web)이 아직 병합되지 않았습니다. 서버만 켜 두었습니다."
  say "플러그인 목록 확인: curl -H \"authorization: Bearer \$(cat $RUN/token)\" $API/api/plugins"
  exit 2
fi
if web_up; then
  say "웹 화면 실행 중 ($WEB)"
else
  say "웹 화면 시작 중..."
  setsid -f bash -c 'echo $$ >"$0/web.pid"; cd "$1/apps/web" && exec ./node_modules/.bin/vite --host 127.0.0.1 --port 5173 --strictPort >"$0/web.log" 2>&1 </dev/null' "$RUN" "$ROOT"
  wait_for "웹 화면" web_up || exit 1
fi

# 4) Windows 브라우저로 열기 (토큰은 주소로 전달 → 화면이 세션 저장소로 옮기고 주소창에서 지움)
[ -n "${HX_NO_BROWSER:-}" ] && { say "준비됨: $WEB/?token=… (HX_NO_BROWSER)"; exit 0; }
say "브라우저를 엽니다"
cmd.exe /c start "" "$WEB/?token=$TOKEN" >/dev/null 2>&1 || explorer.exe "$WEB/?token=$TOKEN"
exit 0
