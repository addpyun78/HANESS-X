# 63.2 real check (ASCII only): start the built desktop app, wait for its harness server (WSL sidecar),
# close the app window, then verify that no sidecar server process is left.
#   powershell -ExecutionPolicy Bypass -File apps\desktop\scripts\e2e-sidecar.ps1 [-Exe <path>] [-RepoWsl <wsl path>]
param(
  [string]$Exe = 'C:\agentCli\harness-x-desktop-build\apps\desktop\src-tauri\target\release\harness-x-desktop.exe',
  [string]$RepoWsl = '/mnt/c/agentCli/harness-x',
  [string]$Distro = 'Ubuntu',
  [int]$StartTimeoutSec = 300,
  # close the app while the server is still booting (not yet listening)
  [switch]$DuringStartup
)
$ErrorActionPreference = 'Stop'
$pattern = '[c]li.js serve --port 0 --no-watch --exit-with-stdin'
function Count-Servers {
  $n = & wsl.exe -d $Distro -e sh -c "pgrep -f '$pattern' | wc -l"
  return [int]($n | Select-Object -Last 1)
}

function Token-Stamp {
  $t = & wsl.exe -d $Distro -e sh -c 'stat -c %Y "${HARNESS_X_HOME:-$HOME/.harness-x}/run/desktop-token" 2>/dev/null || echo 0'
  return [long]($t | Select-Object -Last 1)
}

$before = Count-Servers
$stamp0 = Token-Stamp
Write-Output ("servers_before=" + $before)
$env:HARNESS_X_REPO_WSL = $RepoWsl
$env:HARNESS_X_WSL_DISTRO = $Distro
$p = Start-Process -FilePath $Exe -PassThru
Write-Output ("app_pid=" + $p.Id)

$deadline = (Get-Date).AddSeconds($StartTimeoutSec)
$running = 0
$ready = $false
while ((Get-Date) -lt $deadline) {
  # ready = the sidecar wrote a fresh desktop-token (it does so right before printing "listening")
  if ($DuringStartup) { if ((Count-Servers) -gt $before) { $ready = $true; break } }
  elseif ((Token-Stamp) -gt $stamp0) { $ready = $true; break }
  Start-Sleep -Seconds 2
}
$running = Count-Servers
Write-Output ("server_ready=" + $ready)
Write-Output ("servers_while_app_running=" + $running)
if (-not $ready -or $running -le $before) { Stop-Process -Id $p.Id -Force; throw 'sidecar server did not start' }
Start-Sleep -Seconds 3

# wait for the window, then close it like a user would (WM_CLOSE)
for ($i = 0; $i -lt 30 -and $p.MainWindowHandle -eq 0; $i++) { Start-Sleep -Milliseconds 500; $p.Refresh() }
[void]$p.CloseMainWindow()
if (-not $p.WaitForExit(30000)) { Stop-Process -Id $p.Id -Force; throw 'app did not exit' }
Write-Output ("app_exit_code=" + $p.ExitCode)

$after = $running
for ($i = 0; $i -lt 60; $i++) {
  $after = Count-Servers
  if ($after -le $before) { break }
  Start-Sleep -Seconds 1
}
Write-Output ("servers_after_app_exit=" + $after)
if ($after -gt $before) { throw 'sidecar server still running after app exit' }
Write-Output 'OK: no sidecar server process after app exit'
