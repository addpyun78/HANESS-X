# Create the HARNESS-X shortcut on the Desktop (ASCII only: Windows PowerShell 5.1 reads BOM-less files as ANSI)
$root = 'C:\agentCli\harness-x'
$desktop = [Environment]::GetFolderPath('Desktop')
$ws = New-Object -ComObject WScript.Shell
$path = Join-Path $desktop 'HARNESS-X.lnk'
$lnk = $ws.CreateShortcut($path)
$lnk.TargetPath = "$root\scripts\launcher\start-harness.cmd"
$lnk.WorkingDirectory = $root
$lnk.IconLocation = "$root\assets\brand\harness-x.ico,0"
$lnk.Description = 'HARNESS-X'
$lnk.WindowStyle = 1
$lnk.Save()
$chk = $ws.CreateShortcut($path)
Write-Output ("target=" + $chk.TargetPath)
Write-Output ("icon=" + $chk.IconLocation)
