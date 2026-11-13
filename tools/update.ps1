<#
.SYNOPSIS
  Updates PoB Agent Edition to the newest release (or rolls back to the previous one).

.DESCRIPTION
  Started from the Overview banner ("Update now") or by hand. Works for all three install types:
  - installer zip (PoB-Agent-Edition-<ver>-win64.zip)
  - portable zip (PoB-Agent-Edition-<ver>-win64-portable.zip, has node\node.exe)
  - git clone (has .git): git pull + submodules + rebuild of agent-mcp
  Zip installs download the matching zip of the release from GitHub over HTTPS and check its SHA256
  against the release's .sha256 file. The current folder is copied to "<folder>.previous" first
  (-Rollback restores it). Builds and settings in Documents\Path of Building are never touched, and
  neither is the portable data folder (UserData, portable.txt). AI app connections are renewed only
  if they were set up before.

.PARAMETER Version
  Install this version (e.g. 0.3.0) instead of the newest. Pre-releases count (every 0.x is one).

.PARAMETER Check
  Only report the installed and newest versions (git installs also check official PoB and atlas data).

.PARAMETER Rollback
  Go back to the version kept in "<folder>.previous" (zip installs) or the commit before the last
  update (git installs).

.PARAMETER ZipFile
  Update from a release zip you downloaded yourself (its .sha256 next to it is checked when present).

.PARAMETER Restart
  Start PoB Agent Edition again when done.

.PARAMETER Yes
  Don't ask before updating.
#>
param(
    [string]$Version,
    [switch]$Check,
    [switch]$Rollback,
    [switch]$Restart,
    [switch]$Yes,
    [string]$ZipFile,
    [string]$Root,   # set when the script re-runs itself from a temp copy
    [string]$Repo = 'urbanvcode/pob-agent-edition'
)
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
if (-not $Root) { $Root = Split-Path -Parent $PSScriptRoot }
$Root = (Resolve-Path $Root).Path.TrimEnd('\')
$Work = Join-Path $env:TEMP 'pob-agent-update'

function Say($msg, $color = 'Gray') { Write-Host $msg -ForegroundColor $color }
function Ok($msg) { Say "  [ok] $msg" Green }
function Warn($msg) { Say "  [!]  $msg" Yellow }
function Done($code = 0) {
    # Keep the window open when something went wrong, or when started by hand
    if ($Host.Name -eq 'ConsoleHost' -and ($code -ne 0 -or -not $Yes)) { Say ''; Read-Host 'Press Enter to close' | Out-Null }
    exit $code
}

# This script is replaced during the update: run from a temp copy so the old file can be overwritten.
if (-not $Check -and $PSCommandPath -and -not $PSCommandPath.StartsWith($Work, [StringComparison]::OrdinalIgnoreCase)) {
    New-Item -ItemType Directory -Force $Work | Out-Null
    $copy = Join-Path $Work 'update.ps1'
    Copy-Item $PSCommandPath $copy -Force
    $argv = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $copy, '-Root', $Root, '-Repo', $Repo)
    if ($Version) { $argv += @('-Version', $Version) }
    if ($ZipFile) { $argv += @('-ZipFile', (Resolve-Path $ZipFile).Path) }
    foreach ($s in @('Rollback', 'Restart', 'Yes')) { if ((Get-Variable $s).Value) { $argv += "-$s" } }
    & powershell.exe @argv
    exit $LASTEXITCODE
}

$PobExe = Join-Path $Root 'PathOfBuilding\runtime\Path{space}of{space}Building.exe'
if (-not (Test-Path $PobExe)) { $PobExe = Join-Path $Root 'PathOfBuilding\runtime\Path of Building.exe' }
$Backup = "$Root.previous"
$InstallType = if (Test-Path (Join-Path $Root '.git')) { 'git' } elseif (Test-Path (Join-Path $Root 'node\node.exe')) { 'portable' } else { 'zip' }
$Current = if (Test-Path (Join-Path $Root 'VERSION')) { (Get-Content (Join-Path $Root 'VERSION') -TotalCount 1).Trim() } else { '0.0.0' }

function Parse-Ver($v) {
    $m = [regex]::Match([string]$v, '^v?(\d+)\.(\d+)\.(\d+)(\S*)$')
    if (-not $m.Success) { return $null }
    return [pscustomobject]@{ V = [version]"$($m.Groups[1].Value).$($m.Groups[2].Value).$($m.Groups[3].Value)"; Pre = $m.Groups[4].Value }
}
function Compare-Ver($a, $b) {
    $x = Parse-Ver $a; $y = Parse-Ver $b
    if (-not $x -or -not $y) { return 0 }
    if ($x.V -ne $y.V) { return [math]::Sign($x.V.CompareTo($y.V)) }
    if ($x.Pre -eq $y.Pre) { return 0 }
    if (-not $x.Pre) { return 1 }; if (-not $y.Pre) { return -1 }
    return [math]::Sign([string]::CompareOrdinal($x.Pre, $y.Pre))
}

function Get-Releases {
    $headers = @{ 'User-Agent' = "pob-agent-edition-updater/$Current"; Accept = 'application/vnd.github+json' }
    $list = Invoke-RestMethod "https://api.github.com/repos/$Repo/releases?per_page=30" -Headers $headers -TimeoutSec 30
    return @($list | Where-Object { -not $_.draft -and (Parse-Ver $_.tag_name) })
}

function Pick-Release($releases) {
    if ($Version) {
        $r = $releases | Where-Object { (Compare-Ver $_.tag_name $Version) -eq 0 } | Select-Object -First 1
        if (-not $r) { throw "Release v$Version was not found on GitHub ($Repo)." }
        return $r
    }
    $best = $null
    foreach ($r in $releases) { if (-not $best -or (Compare-Ver $r.tag_name $best.tag_name) -gt 0) { $best = $r } }
    return $best
}

# PoB and the MCP server's helpers (node, luajit) started from this folder keep files open.
function Get-FolderProcesses {
    $prefix = "$Root\"
    Get-Process -ErrorAction SilentlyContinue | Where-Object {
        try { $_.Path -and $_.Path.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) } catch { $false }
    }
}

function Wait-Closed {
    $deadline = (Get-Date).AddSeconds(60)
    $asked = $false
    while ($true) {
        $procs = @(Get-FolderProcesses)
        if (-not $procs) { return }
        $pob = @($procs | Where-Object { $_.ProcessName -like 'Path*' })
        if ($pob -and -not $asked) { Say 'Waiting for PoB Agent Edition to close...'; $asked = $true }
        if (-not $pob -and (Get-Date) -gt $deadline.AddSeconds(-50)) {
            # Only the AI server helpers are left (an AI app is connected). They restart on the next AI question.
            $names = ($procs | ForEach-Object { $_.ProcessName } | Sort-Object -Unique) -join ', '
            $answer = if ($Yes) { 'y' } else { Read-Host "Your AI app is using PoB Agent Edition ($names). Stop those helper processes now? They start again on the next AI question. [Y/n]" }
            if ($answer -eq '' -or $answer -match '^[yY]') { $procs | Stop-Process -Force; Start-Sleep -Seconds 1; continue }
            throw 'Close your AI app (Claude, Codex, ...) and run the update again.'
        }
        if ((Get-Date) -gt $deadline) { throw 'PoB Agent Edition is still running. Close it and run the update again.' }
        Start-Sleep -Milliseconds 500
    }
}

# Program folders/files come from the release; everything else in the root (UserData, portable.txt,
# mcp-config.json, *.bak) stays. Inside PathOfBuilding, runtime settings and screenshots stay too.
function Copy-Program($from, $to, [string[]]$keepDirs = @()) {
    foreach ($item in Get-ChildItem -LiteralPath $from -Force) {
        if ($keepDirs -contains $item.Name) { continue }
        $dest = Join-Path $to $item.Name
        if ($item.PSIsContainer) {
            $rc = @($item.FullName, $dest, '/MIR', '/R:2', '/W:1', '/NFL', '/NDL', '/NJH', '/NJS', '/NP',
                    '/XD', (Join-Path $dest 'runtime\SimpleGraphic\Screenshots'), (Join-Path $dest 'UserData'),
                    '/XF', 'imgui.ini', 'SimpleGraphic.cfg')
            & robocopy.exe @rc | Out-Null
            if ($LASTEXITCODE -ge 8) { throw "Copying $($item.Name) failed (robocopy code $LASTEXITCODE). A file may still be in use." }
        } else {
            Copy-Item -LiteralPath $item.FullName $dest -Force
        }
    }
}

function Make-Backup {
    Say "Keeping the current version as a backup: $Backup"
    New-Item -ItemType Directory -Force $Backup | Out-Null
    $rc = @($Root, $Backup, '/MIR', '/R:2', '/W:1', '/NFL', '/NDL', '/NJH', '/NJS', '/NP', '/XD', (Join-Path $Root 'UserData'), (Join-Path $Root 'dist'))
    & robocopy.exe @rc | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "Backup failed (robocopy code $LASTEXITCODE)." }
    Ok "backup of v$Current"
}

# Renew the AI app connections, but only where they were set up before.
function Reconnect {
    $installer = Join-Path $Root 'install.ps1'
    if (-not (Test-Path (Join-Path $Root 'mcp-config.json'))) { Say '  [-]  AI apps were not connected from this folder (skipped)'; return }
    $argv = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $installer, '-Quiet')
    if ($InstallType -eq 'portable') { $argv += '-Portable' }
    & powershell.exe @argv
    if ($LASTEXITCODE -eq 0) { Ok 'AI app connections renewed (restart your AI app)' } else { Warn 'Could not renew the AI app connections: run Install.cmd (or Connect AI apps.cmd) again.' }
}

function Start-Pob {
    if ($Restart -and (Test-Path $PobExe)) { Start-Process -FilePath $PobExe -WorkingDirectory (Split-Path $PobExe); Ok 'PoB Agent Edition started' }
}

# ------------------------------------------------------------------------------------------------
Say "PoB Agent Edition v$Current ($InstallType install) in $Root" Cyan

if ($Check) {
    try {
        $latest = Pick-Release (Get-Releases)
        $lv = $latest.tag_name -replace '^v', ''
        if ((Compare-Ver $lv $Current) -gt 0) { Say "Update available: v$lv  $($latest.html_url)" Yellow } else { Ok "up to date (newest release: v$lv)" }
    } catch { Warn "Could not reach GitHub: $($_.Exception.Message)" }
    if ($InstallType -eq 'git') {
        foreach ($s in @('update-pob.ps1', 'update-atlas.ps1')) {
            $p = Join-Path $Root "tools\$s"
            if (Test-Path $p) { Say "--- $s -Check"; & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $p -Check }
        }
    }
    exit 0
}

try {
    if ($InstallType -eq 'git') {
        $prevFile = Join-Path $Root '.git\pob-agent-previous-head'
        if ($Rollback) {
            if (-not (Test-Path $prevFile)) { throw 'No earlier update to roll back to.' }
            $prev = (Get-Content $prevFile -TotalCount 1).Trim()
            Wait-Closed
            Say "Rolling back to $prev..."
            & git -C $Root reset --keep $prev; if ($LASTEXITCODE -ne 0) { throw 'git reset --keep failed (local changes in the way?).' }
        } else {
            if (& git -C $Root status --porcelain --untracked-files=no) { throw 'This git checkout has uncommitted changes. Commit or stash them first (or update by hand).' }
            Wait-Closed
            Set-Content $prevFile (& git -C $Root rev-parse HEAD) -Encoding ASCII
            Say 'git pull...'
            & git -C $Root pull --ff-only; if ($LASTEXITCODE -ne 0) { throw 'git pull --ff-only failed.' }
        }
        & git -C $Root submodule update --init --recursive; if ($LASTEXITCODE -ne 0) { throw 'git submodule update failed.' }
        Push-Location (Join-Path $Root 'agent-mcp')
        try {
            & npm ci --no-audit --no-fund; if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' }
            & npm run build; if ($LASTEXITCODE -ne 0) { throw 'npm run build failed' }
        } finally { Pop-Location }
        $Current = (Get-Content (Join-Path $Root 'VERSION') -TotalCount 1).Trim()
        Ok "now on v$Current ($(& git -C $Root rev-parse --short HEAD))"
        Reconnect; Start-Pob; Done 0
    }

    if ($Rollback) {
        if (-not (Test-Path (Join-Path $Backup 'VERSION'))) { throw "No backup found at $Backup." }
        $old = (Get-Content (Join-Path $Backup 'VERSION') -TotalCount 1).Trim()
        if (-not $Yes -and (Read-Host "Roll back from v$Current to v$old? [Y/n]") -notmatch '^([yY]|)$') { Done 1 }
        Wait-Closed
        Copy-Program $Backup $Root @('UserData', 'portable.txt', 'mcp-config.json')
        Ok "rolled back to v$old"
        Reconnect; Start-Pob; Done 0
    }

    if ($ZipFile) {
        # Update from a zip downloaded by hand (offline, or a test build). Its .sha256 is checked when present.
        $zip = (Resolve-Path $ZipFile).Path
        if (Test-Path "$zip.sha256") {
            $expected = ((Get-Content "$zip.sha256" -TotalCount 1) -split '\s+')[0].ToLower()
            $actual = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
            if ($expected -ne $actual) { throw "SHA256 check failed (expected $expected, got $actual). Nothing was changed." }
            Ok 'SHA256 verified'
        } else { Warn "no $(Split-Path $zip -Leaf).sha256 next to the zip: not verified" }
        $dl = Join-Path $Work 'zipfile'
        if (Test-Path $dl) { Remove-Item $dl -Recurse -Force }
        New-Item -ItemType Directory -Force $dl | Out-Null
        $target = $null
    } else {
    Say 'Asking GitHub for the newest release...'
    $rel = Pick-Release (Get-Releases)
    if (-not $rel) { throw "No releases found for $Repo." }
    $target = $rel.tag_name -replace '^v', ''
    if (-not $Version -and (Compare-Ver $target $Current) -le 0) { Ok "already up to date (v$Current)"; Start-Pob; Done 0 }

    $suffix = if ($InstallType -eq 'portable') { '-win64-portable.zip' } else { '-win64.zip' }
    $zipName = "PoB-Agent-Edition-$target$suffix"
    $asset = $rel.assets | Where-Object { $_.name -eq $zipName } | Select-Object -First 1
    $sumAsset = $rel.assets | Where-Object { $_.name -eq "$zipName.sha256" } | Select-Object -First 1
    if (-not $asset -or -not $sumAsset) { throw "Release v$target has no $zipName (+ .sha256). Download it by hand from $($rel.html_url)." }
    if (-not $Yes -and (Read-Host "Update v$Current -> v$target? [Y/n]") -notmatch '^([yY]|)$') { Done 1 }

    $dl = Join-Path $Work $target
    if (Test-Path $dl) { Remove-Item $dl -Recurse -Force }
    New-Item -ItemType Directory -Force $dl | Out-Null
    $zip = Join-Path $dl $zipName
    Say "Downloading $zipName ($([math]::Round($asset.size / 1MB, 1)) MB)..."
    $ProgressPreference = 'SilentlyContinue'   # the progress bar makes Invoke-WebRequest very slow on PS 5.1
    Invoke-WebRequest $asset.browser_download_url -OutFile $zip -UseBasicParsing -TimeoutSec 600
    Invoke-WebRequest $sumAsset.browser_download_url -OutFile "$zip.sha256" -UseBasicParsing -TimeoutSec 60
    $expected = ((Get-Content "$zip.sha256" -TotalCount 1) -split '\s+')[0].ToLower()
    $actual = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
    if ($expected -notmatch '^[0-9a-f]{64}$' -or $expected -ne $actual) { throw "SHA256 check failed (expected $expected, got $actual). Nothing was changed." }
    Ok 'SHA256 verified'
    }

    $tar = Join-Path $env:SystemRoot 'System32\tar.exe'
    $ex = Join-Path $dl 'x'
    New-Item -ItemType Directory -Force $ex | Out-Null
    & $tar -x -f $zip -C $ex; if ($LASTEXITCODE -ne 0) { throw 'Extracting the zip failed.' }
    $newRoot = Get-ChildItem $ex -Directory | Select-Object -First 1
    if (-not $newRoot -or -not (Test-Path (Join-Path $newRoot.FullName 'VERSION'))) { throw 'The zip does not look like PoB Agent Edition (0.3.0 or newer).' }
    if (-not $target) { $target = (Get-Content (Join-Path $newRoot.FullName 'VERSION') -TotalCount 1).Trim() }
    if ($ZipFile -and -not $Yes -and (Read-Host "Update v$Current -> v$target from $(Split-Path $zip -Leaf)? [Y/n]") -notmatch '^([yY]|)$') { Done 1 }

    Wait-Closed
    Make-Backup
    Say 'Replacing the program files...'
    # Portable: the bundled Node.js is replaced too (it is part of the release), unless it is in use.
    Copy-Program $newRoot.FullName $Root
    $now = (Get-Content (Join-Path $Root 'VERSION') -TotalCount 1).Trim()
    if ($now -ne $target) { throw "Update incomplete (VERSION says $now). Run tools\update.ps1 -Rollback." }
    Ok "updated to v$target"
    Remove-Item $dl -Recurse -Force -ErrorAction SilentlyContinue
    Reconnect
    Start-Pob
    Say "Done. To go back: tools\update.ps1 -Rollback" Green
    Done 0
} catch {
    Say "Update failed: $($_.Exception.Message)" Red
    if (Test-Path $Backup) { Say "Your previous version is kept in $Backup (tools\update.ps1 -Rollback)." }
    Done 1
}
