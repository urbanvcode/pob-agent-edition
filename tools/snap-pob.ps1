<#
.SYNOPSIS
  Saves a PNG screenshot of the PoB Agent Edition window (works while it is in the background).
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File snap-pob.ps1 -Out C:\temp\pob.png
#>
param([Parameter(Mandatory)][string]$Out, [int]$ProcessId = 0)

Add-Type -AssemblyName System.Drawing
Add-Type -Namespace Snap -Name W -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hwnd, IntPtr hdc, uint flags);
[DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hwnd, out RECT r);
[StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
'@

$repo = Join-Path (Split-Path -Parent $PSScriptRoot) 'PathOfBuilding'
$p = if ($ProcessId) { Get-Process -Id $ProcessId } else { Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$repo\*" -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1 }
if (-not $p) { throw 'PoB Agent Edition is not running' }
$h = $p.MainWindowHandle
$r = New-Object Snap.W+RECT
[void][Snap.W]::GetClientRect($h, [ref]$r)
$w = $r.Right - $r.Left; $ht = $r.Bottom - $r.Top
if ($w -le 0 -or $ht -le 0) { throw 'PoB window is minimized' }
$bmp = New-Object System.Drawing.Bitmap $w, $ht
$g = [System.Drawing.Graphics]::FromImage($bmp)
$hdc = $g.GetHdc()
# 1 = PW_CLIENTONLY, 2 = PW_RENDERFULLCONTENT (needed for GPU-drawn windows)
[void][Snap.W]::PrintWindow($h, $hdc, 3)
$g.ReleaseHdc($hdc); $g.Dispose()
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
"$Out ($w x $ht)"
