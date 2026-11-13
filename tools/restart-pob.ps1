<#
.SYNOPSIS
  Restarts PoB Agent Edition (dev helper) and waits for its live server.
  -Background starts it without taking keyboard focus.
#>
param([switch]$Background)
$repo = Join-Path (Split-Path -Parent $PSScriptRoot) 'PathOfBuilding'
Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$repo\*" } | Stop-Process -Force
Start-Sleep -Milliseconds 800
$exe = Join-Path $repo 'runtime\Path{space}of{space}Building.exe'
$style = if ($Background) { 'Minimized' } else { 'Normal' }
$p = Start-Process -FilePath $exe -WorkingDirectory (Split-Path $exe) -WindowStyle $style -PassThru
for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Milliseconds 500
    if (Test-NetConnection 127.0.0.1 -Port 31337 -WarningAction SilentlyContinue -InformationLevel Quiet) { break }
}
if ($Background) {
    Add-Type -Namespace RP -Name W -MemberDefinition '[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);'
    $p.Refresh()
    # 4 = SW_SHOWNOACTIVATE: visible (so it renders) but does not steal focus
    [void][RP.W]::ShowWindow($p.MainWindowHandle, 4)
}
"PoB Agent Edition running (pid $($p.Id))"
