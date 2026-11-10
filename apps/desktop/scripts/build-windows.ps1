# HARNESS-X desktop build on Windows (ASCII only: Windows PowerShell 5.1 reads BOM-less files as ANSI)
#
# The repo's node_modules are installed by Linux pnpm (WSL), so the Windows toolchain cannot use them.
# This script copies apps/desktop (+ the already built apps/web/dist) to a separate Windows-side folder,
# installs it there with Windows pnpm and runs `pnpm --filter desktop tauri build`.
#
#   1) WSL:      pnpm --filter web build
#   2) Windows:  powershell -ExecutionPolicy Bypass -File apps\desktop\scripts\build-windows.ps1 [-Test]
#
# Output: <Out>\apps\desktop\src-tauri\target\release\harness-x-desktop.exe
#         <Out>\apps\desktop\src-tauri\target\release\bundle\msi\*.msi, ...\bundle\nsis\*-setup.exe
param(
  [string]$Src = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path,
  [string]$Out = 'C:\agentCli\harness-x-desktop-build',
  [switch]$Test,
  [switch]$NoBundle
)
$ErrorActionPreference = 'Stop'
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
$env:CI = 'true'

if (-not (Test-Path (Join-Path $Src 'apps\web\dist\index.html'))) {
  throw "apps\web\dist is missing. Run 'pnpm --filter web build' in WSL first."
}

function Copy-Tree($from, $to, [string[]]$excludeDirs) {
  $rcArgs = @($from, $to, '/MIR', '/NFL', '/NDL', '/NJH', '/NJS', '/NP')
  if ($excludeDirs) { $rcArgs += '/XD'; $rcArgs += $excludeDirs }
  & robocopy @rcArgs | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "robocopy failed ($LASTEXITCODE): $from" }
}

New-Item -ItemType Directory -Force -Path $Out | Out-Null
Copy-Tree (Join-Path $Src 'apps\desktop') (Join-Path $Out 'apps\desktop') @('node_modules', 'target', 'gen')
Copy-Tree (Join-Path $Src 'apps\web\dist') (Join-Path $Out 'apps\web\dist') @()

Set-Content -Encoding ASCII -Path (Join-Path $Out 'pnpm-workspace.yaml') -Value "packages:`n  - 'apps/desktop'`n"
Set-Content -Encoding ASCII -Path (Join-Path $Out 'package.json') -Value '{ "name": "harness-x-desktop-build", "private": true }'

Push-Location $Out
try {
  pnpm install --config.confirmModulesPurge=false
  if ($LASTEXITCODE -ne 0) { throw "pnpm install failed ($LASTEXITCODE)" }
  if ($Test) {
    Push-Location 'apps\desktop\src-tauri'
    cargo test --release -- --test-threads=1
    $code = $LASTEXITCODE
    Pop-Location
    if ($code -ne 0) { throw "cargo test failed ($code)" }
  }
  if ($NoBundle) { pnpm --filter desktop tauri build --no-bundle } else { pnpm --filter desktop tauri build }
  if ($LASTEXITCODE -ne 0) { throw "tauri build failed ($LASTEXITCODE)" }
} finally {
  Pop-Location
}

$rel = Join-Path $Out 'apps\desktop\src-tauri\target\release'
Get-ChildItem -Path $rel -Filter 'harness-x-desktop.exe' | ForEach-Object { Write-Output ('exe=' + $_.FullName) }
Get-ChildItem -Path (Join-Path $rel 'bundle') -Recurse -Include '*.msi', '*-setup.exe' -ErrorAction SilentlyContinue |
  ForEach-Object { Write-Output ('installer=' + $_.FullName) }
