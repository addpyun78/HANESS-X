# Create the HARNESS-X shortcut on the Desktop (ASCII only: Windows PowerShell 5.1 reads BOM-less files as ANSI)
#
# If the desktop app (T-063, Tauri) is installed or built, HARNESS-X.lnk points to it and a second
# shortcut "HARNESS-X (browser).lnk" keeps the browser launcher. Otherwise HARNESS-X.lnk is the browser launcher.
#   -Browser     always use the browser launcher for HARNESS-X.lnk
#   -App <exe>   use this desktop exe
param(
  [switch]$Browser,
  [string]$App = ''
)
$root = 'C:\agentCli\harness-x'
$desktop = [Environment]::GetFolderPath('Desktop')
$ws = New-Object -ComObject WScript.Shell
$icon = "$root\assets\brand\harness-x.ico,0"
$launcher = "$root\scripts\launcher\start-harness.cmd"
# T-102 I.2: the main shortcut runs the launcher hidden (no black console window) via wscript + start-harness.vbs
$hidden = "$root\scripts\launcher\start-harness.vbs"
$wscript = Join-Path $env:WINDIR 'System32\wscript.exe'

function Find-DesktopApp {
  $candidates = @(
    (Join-Path $env:LOCALAPPDATA 'HARNESS-X\HARNESS-X.exe'),            # NSIS (per-user)
    (Join-Path $env:LOCALAPPDATA 'Programs\HARNESS-X\HARNESS-X.exe'),
    (Join-Path $env:ProgramFiles 'HARNESS-X\HARNESS-X.exe'),             # MSI
    'C:\agentCli\harness-x-desktop-build\apps\desktop\src-tauri\target\release\harness-x-desktop.exe'  # built, not installed
  )
  foreach ($c in $candidates) { if ($c -and (Test-Path $c)) { return $c } }
  return $null
}

function New-Shortcut($name, $target, $workdir, $iconLocation, $arguments = '') {
  $path = Join-Path $desktop $name
  $lnk = $ws.CreateShortcut($path)
  $lnk.TargetPath = $target
  $lnk.Arguments = $arguments
  $lnk.WorkingDirectory = $workdir
  $lnk.IconLocation = $iconLocation
  $lnk.Description = 'HARNESS-X'
  $lnk.WindowStyle = 1
  $lnk.Save()
  $chk = $ws.CreateShortcut($path)
  Write-Output ("shortcut=" + $path)
  Write-Output ("target=" + $chk.TargetPath + ' ' + $chk.Arguments)
  Write-Output ("icon=" + $chk.IconLocation)
}

$exe = $null
if (-not $Browser) {
  if ($App) { $exe = $App } else { $exe = Find-DesktopApp }
}

if ($exe) {
  New-Shortcut 'HARNESS-X.lnk' $exe (Split-Path $exe) ($exe + ',0')
  New-Shortcut 'HARNESS-X (browser).lnk' $wscript $root $icon ('"' + $hidden + '"')
} else {
  New-Shortcut 'HARNESS-X.lnk' $wscript $root $icon ('"' + $hidden + '"')
}
# troubleshooting shortcut: same launcher with the console window visible
New-Shortcut 'HARNESS-X (troubleshoot).lnk' $launcher $root $icon
