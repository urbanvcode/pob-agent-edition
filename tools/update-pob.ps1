<#
.SYNOPSIS
  Keeps PoB Agent Edition in sync with the official Path of Building releases.

.DESCRIPTION
  Finds the newest official PathOfBuildingCommunity release tag, re-applies our
  Agent Edition commits on top of it (git rebase --onto), checks that the code
  still compiles with our LuaJIT and runs agent-mcp's headless contract tests.

  Our commits live on the "agent" branch of the PathOfBuilding submodule. The official repo is the
  "upstream" remote (added automatically); "origin" is our private fork.
  If a rebase conflicts, the script stops and leaves the repo mid-rebase so the
  conflict can be fixed (or undone with: git rebase --abort).

.PARAMETER Check
  Only report whether an update is available; change nothing.

.PARAMETER Tag
  Update to a specific release tag (e.g. v2.68.0) instead of the newest.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File tools\update-pob.ps1 -Check
#>
param(
    [switch]$Check,
    [string]$Tag
)

$ErrorActionPreference = 'Stop'
$Root   = Split-Path -Parent $PSScriptRoot
$Repo   = if ($env:POB_AGENT_REPO) { $env:POB_AGENT_REPO } else { Join-Path $Root 'PathOfBuilding' }
$McpDir = Join-Path $Root 'agent-mcp'
$LuaJit = Join-Path $Root 'luajit\luajit.exe'

function RepoGit { & git -C $Repo @args; if ($LASTEXITCODE -ne 0) { throw "git $($args -join ' ') failed" } }

# Official PoB releases come from the "upstream" remote; "origin" is our private fork.
$Upstream = 'upstream'
& git -C $Repo remote get-url $Upstream *> $null
if ($LASTEXITCODE -ne 0) { RepoGit remote add $Upstream 'https://github.com/PathOfBuildingCommunity/PathOfBuilding.git' }

# The atlas tree comes from GGG directly (not from PoB releases), so check it every time
Write-Host "Checking GGG's atlas tree export..."
& (Join-Path $PSScriptRoot 'update-atlas.ps1') -Check:$Check

$branch = (RepoGit rev-parse --abbrev-ref HEAD).Trim()
if ($branch -ne 'agent') { throw "PathOfBuilding is on '$branch', expected 'agent'." }

$current = (RepoGit describe --tags --abbrev=0 HEAD).Trim()

if (-not $Tag) {
    $tags = RepoGit ls-remote --tags --refs $Upstream 'v*' | ForEach-Object { ($_ -split 'refs/tags/')[1] } |
        Where-Object { $_ -match '^v\d+\.\d+\.\d+$' }
    $Tag = $tags | Sort-Object { [version]$_.TrimStart('v') } | Select-Object -Last 1
}

$installed = $null
$manifest = Join-Path $env:APPDATA 'Path of Building Community\manifest.xml'
if (Test-Path $manifest) {
    $installed = ([xml](Get-Content $manifest -Raw)).PoBVersion.Version.number
}

Write-Host "Agent Edition based on : $current"
Write-Host "Newest official release: $Tag"
if ($installed) { Write-Host "Your installed PoB      : v$installed" }

# Preview commits = upstream work taken early (e.g. a new tree before PoB released it).
# They carry "[upstream-preview: <path>]" and are dropped once a release contains <path>.
# For changes to files that already exist (e.g. uniques), the marker names text the release must contain:
# [upstream-preview: <path> contains "<text>"].
$ourCommits = @(RepoGit rev-list --reverse "$current..agent")
$previews = foreach ($c in $ourCommits) {
    $msg = (RepoGit log -1 --format=%B $c) -join "`n"
    if ($msg -match '\[upstream-preview:\s*([^\]]+)\]') {
        $spec = $Matches[1].Trim(); $text = $null
        if ($spec -match '^(.+?)\s+contains\s+"([^"]+)"$') { $spec = $Matches[1]; $text = $Matches[2] }
        [pscustomobject]@{ Commit = $c; Path = $spec; Text = $text; Title = (RepoGit log -1 --format=%s $c) }
    }
}
# True when release $ref already has the preview's path (and its text, if the marker names one).
function Test-PreviewInRelease($preview, $ref) {
    if ($preview.Text) {
        & git -C $Repo grep -q -F -e $preview.Text $ref -- $preview.Path 2>$null
    } else {
        & git -C $Repo cat-file -e "${ref}:$($preview.Path)" 2>$null
    }
    return ($LASTEXITCODE -eq 0)
}
foreach ($p in $previews) { Write-Host "Preview in use         : $($p.Title)" -ForegroundColor DarkYellow }

if ([version]$Tag.TrimStart('v') -le [version]$current.TrimStart('v')) {
    Write-Host "Already up to date." -ForegroundColor Green
    if ($previews) { Write-Host "Previews stay until an official PoB release includes them." }
    exit 0
}
if ($Check) {
    Write-Host "Update available: $current -> $Tag (run without -Check to apply)." -ForegroundColor Yellow
    exit 0
}
if (RepoGit status --porcelain) { throw "PathOfBuilding has uncommitted changes; commit or stash them first." }

$running = Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$Repo\*" }
if ($running) { Write-Host "Note: PoB Agent Edition is running; restart it after the update." -ForegroundColor Yellow }

Write-Host "Fetching $Tag..."
& git -C $Repo rev-parse -q --verify "refs/tags/$Tag" *> $null
if ($LASTEXITCODE -ne 0) { RepoGit fetch $Upstream tag $Tag --no-tags }

$backup = "agent-backup-$($current.TrimStart('v'))"
RepoGit branch -f $backup HEAD
Write-Host "Backup of the current version: branch $backup"

Write-Host "Re-applying Agent Edition changes onto $Tag..."
RepoGit checkout -q --detach $Tag
foreach ($c in $ourCommits) {
    $preview = $previews | Where-Object { $_.Commit -eq $c }
    if ($preview) {
        if (Test-PreviewInRelease $preview $Tag) {
            Write-Host "  dropping preview (now official in $Tag): $($preview.Title)" -ForegroundColor Green
            continue
        }
        Write-Host "  keeping preview (not in $Tag yet): $($preview.Title)" -ForegroundColor DarkYellow
    }
    & git -C $Repo cherry-pick --allow-empty --keep-redundant-commits $c *> $null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Conflict while re-applying $(RepoGit log -1 --format=%s $c)." -ForegroundColor Red
        Write-Host "Fix it in $Repo and run 'git cherry-pick --continue', then 'git branch -f agent HEAD; git checkout agent'." -ForegroundColor Red
        Write-Host "Or go back: git -C `"$Repo`" cherry-pick --abort; git -C `"$Repo`" checkout agent" -ForegroundColor Red
        exit 1
    }
}
RepoGit branch -f agent HEAD
RepoGit checkout -q agent

Write-Host "Compile check..."
& $LuaJit -bl (Join-Path $Repo 'src\Modules\Main.lua') > $null
if ($LASTEXITCODE -ne 0) {
    Write-Host "LuaJIT cannot compile this PoB version (it may use newer syntax). Restore with: git -C `"$Repo`" reset --hard $backup" -ForegroundColor Red
    exit 1
}

Write-Host "Headless contract tests..."
$env:POB_LIVE = 'off'
$env:POB_LUA_ENABLED = 'true'
$env:POB_CMD = $LuaJit
$env:POB_PATH = Join-Path $Repo 'src'
$env:PATH = "$(Split-Path $LuaJit);$env:PATH"
Push-Location $McpDir
try {
    & npm test
    if ($LASTEXITCODE -ne 0) { throw "agent-mcp tests failed" }
} finally { Pop-Location }

Write-Host "Updated PoB Agent Edition to $Tag." -ForegroundColor Green

