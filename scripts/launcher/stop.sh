#!/bin/bash
# HARNESS-X 종료: 실행기가 띄운 서버·웹 화면 프로세스를 끈다
RUN="${HARNESS_X_HOME:-$HOME/.harness-x}/run"
for p in web server; do
  if [ -f "$RUN/$p.pid" ]; then kill "$(cat "$RUN/$p.pid")" 2>/dev/null && echo "stopped $p"; rm -f "$RUN/$p.pid"; fi
done
