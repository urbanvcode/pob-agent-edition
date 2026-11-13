<#
.SYNOPSIS
  Updates PoB Agent Edition's Atlas tree to GGG's latest official export.

.DESCRIPTION
  Pulls github.com/grindinggear/atlastree-export (kept in atlastree-export\ at the repo root, not committed),
  reads the version from GGG's latest commit (e.g. "3.30.0 preview 2" -> 3_30) and copies
  data.json plus the full-resolution sprite sheets to
  PathOfBuilding\src\TreeData\Atlas\<version>\. The Atlas tab picks the newest folder
  automatically; restart PoB Agent Edition afterwards. Older versions are kept, so atlas
  setups saved in builds keep loading.

.PARAMETER Check
  Only report whether GGG has published something newer.
#>
param([switch]$Check)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Export = Join-Path $Root 'atlastree-export'
$AtlasDir = Join-Path $Root 'PathOfBuilding\src\TreeData\Atlas'

if (-not (Test-Path (Join-Path $Export '.git'))) {
    Write-Host "Downloading GGG's atlas export..."
    git clone --depth 1 https://github.com/grindinggear/atlastree-export.git $Export
} else {
    git -C $Export fetch --depth 1 origin master
    if ($LASTEXITCODE -ne 0) { throw 'git fetch failed' }
    $local = (git -C $Export rev-parse HEAD).Trim()
    $remote = (git -C $Export rev-parse FETCH_HEAD).Trim()
    if ($local -eq $remote) {
        Write-Host "Atlas data is already the latest from GGG: $(git -C $Export log -1 --format='%s (%cd)' --date=short)" -ForegroundColor Green
        if ($Check) { exit 0 }
    } elseif ($Check) {
        Write-Host "GGG published new atlas data: $(git -C $Export log -1 --format='%s (%cd)' --date=short FETCH_HEAD). Run without -Check to install." -ForegroundColor Yellow
        exit 0
    }
    git -C $Export reset --hard FETCH_HEAD | Out-Null
}

$subject = (git -C $Export log -1 --format='%s').Trim()
if ($subject -notmatch '(\d+)\.(\d+)') { throw "Cannot read a version from GGG's commit message '$subject'" }
$version = "$($Matches[1])_$($Matches[2])"
$dest = Join-Path $AtlasDir $version
New-Item -ItemType Directory -Force $dest | Out-Null

Copy-Item (Join-Path $Export 'data.json') $dest -Force
$sheets = 'atlas-skills', 'atlas-skills-disabled', 'atlas-mastery', 'atlas-frame', 'atlas-group-background', 'atlas-line'
foreach ($s in $sheets) {
    $src = Get-ChildItem (Join-Path $Export 'assets') -Filter "$s-*.webp" | Sort-Object Name | Select-Object -Last 1
    if ($src) { Copy-Item $src.FullName $dest -Force }
}
$overlay = Join-Path $Export 'assets\atlas-mastery-overlay.webp'
if (Test-Path $overlay) { Copy-Item $overlay $dest -Force }
Set-Content (Join-Path $dest 'source.txt') "GGG atlastree-export: $subject ($(git -C $Export log -1 --format='%h %cd' --date=short))"

Write-Host "Installed atlas $version from GGG ($subject). Restart PoB Agent Edition to use it." -ForegroundColor Green
