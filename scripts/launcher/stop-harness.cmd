@echo off
wsl.exe -d Ubuntu -e bash -l "/mnt/c/agentCli/harness-x/scripts/launcher/stop.sh"
timeout /t 2 >nul
