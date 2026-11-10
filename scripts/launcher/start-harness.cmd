@echo off
chcp 65001 >nul
title HARNESS-X
wsl.exe -d Ubuntu -e bash -l "/mnt/c/agentCli/harness-x/scripts/launcher/start.sh"
if errorlevel 1 (
  echo.
  echo 문제가 있으면 이 창 내용을 알려주세요.
  pause
) else (
  timeout /t 4 >nul
)
