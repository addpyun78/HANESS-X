#!/bin/sh
# Claude Code PreToolUse 훅: 표준입력 JSON의 명령에 rm -rf가 있으면 종료코드 2(차단)
input=$(cat)
case "$input" in
  *"rm -rf"*)
    echo "위험한 명령 차단: rm -rf" >&2
    exit 2
    ;;
esac
exit 0
