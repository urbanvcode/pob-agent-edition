<#
.SYNOPSIS
  Builds the release zip (and optionally publishes a GitHub release).

.DESCRIPTION
  Uses only committed code: `git archive` of each repo, so uncommitted work and local files
  (builds, AgentEdition.json, settings) can never end up in a release.
  Steps: secret scan, export PathOfBuilding + pob-mcp + root files, build the MCP server,
  drop dev dependencies, add LuaJIT, zip to dist\PoB-Agent-Edition-<version>-win64.zip.

.PARAMETER Version
  Version without "v", e.g. 0.1.0. Must have a section in CHANGELOG.md.

.PARAMETER Publish
  Also tag v<Version> and create a GitHub release with the changelog section as notes.
  The release is marked as a pre-release while the version is below 1.0.0.
#>
param(
    [Parameter(Mandatory)][string]$Version,
    [switch]$Publish
)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Name = "PoB-Agent-Edition-$Version-win64"
$Dist = Join-Path $Root 'dist'
$Stage = Join-Path $env:TEMP "pob-agent-release\$Name"

$Tar = Join-Path $env:SystemRoot 'System32\tar.exe'  # Windows bsdtar (Git Bash's GNU tar misreads C: paths and cannot write zip)
# Arguments go in as one array: passing --flags through a PowerShell function's own parameters mangles them
function Run([string]$exe, [string[]]$argv) { & $exe @argv; if ($LASTEXITCODE -ne 0) { throw "$exe $($argv -join ' ') failed" } }

$changelog = Get-Content (Join-Path $Root 'CHANGELOG.md') -Raw
$m = [regex]::Match($changelog, "(?ms)^## \[$([regex]::Escape($Version))\][^\n]*\n(.*?)(?=^## \[|^\[Unreleased\]:)")
if (-not $m.Success) { throw "CHANGELOG.md has no section '## [$Version]'." }
$notes = $m.Groups[1].Value.Trim()

& (Join-Path $PSScriptRoot 'check-secrets.ps1'); if ($LASTEXITCODE -ne 0) { throw 'Secret scan failed.' }

foreach ($r in @('PathOfBuilding', 'pob-mcp')) {
    $dirty = & git -C (Join-Path $Root $r) status --porcelain --untracked-files=no
    if ($dirty) { Write-Host "Note: $r has uncommitted changes; they are NOT included (release uses committed code)." -ForegroundColor Yellow }
}

if (Test-Path $Stage) { Remove-Item $Stage -Recurse -Force }
New-Item -ItemType Directory -Force $Stage | Out-Null

Write-Host 'Exporting committed code...'
$tarFile = Join-Path $env:TEMP 'pob-agent-release\part.tar'
Run git @('-C', $Root, 'archive', '--format=tar', '-o', $tarFile, 'HEAD')
Run $Tar @('-x', '-f', $tarFile, '-C', $Stage)
foreach ($r in @('PathOfBuilding', 'pob-mcp')) {
    $dest = Join-Path $Stage $r
    New-Item -ItemType Directory -Force $dest | Out-Null
    Run git @('-C', (Join-Path $Root $r), 'archive', '--format=tar', '-o', $tarFile, 'HEAD')
    Run $Tar @('-x', '-f', $tarFile, '-C', $dest)
}
Remove-Item $tarFile -Force

Write-Host 'Building the MCP server...'
Push-Location (Join-Path $Stage 'pob-mcp')
try {
    Run npm @('ci', '--no-audit', '--no-fund')
    Run npm @('run', 'build')
    Run npm @('prune', '--omit=dev', '--no-audit', '--no-fund')
} finally { Pop-Location }

# Not needed by players
foreach ($p in @('PathOfBuilding\spec', 'PathOfBuilding\tests', 'PathOfBuilding\runtime-win32.zip', 'PathOfBuilding\.github',
                 'pob-mcp\.github', 'pob-mcp\.auto', 'pob-mcp\.claude', 'pob-mcp\tests')) {
    $full = Join-Path $Stage $p
    if (Test-Path $full) { Remove-Item $full -Recurse -Force }
}

New-Item -ItemType Directory -Force $Dist | Out-Null
$zip = Join-Path $Dist "$Name.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }
Write-Host 'Zipping...'
Push-Location (Split-Path $Stage)
try { Run $Tar @('-a', '-c', '-f', $zip, $Name) } finally { Pop-Location }
$sizeMb = [math]::Round((Get-Item $zip).Length / 1MB, 1)
$hash = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
Set-Content "$zip.sha256" "$hash  $Name.zip" -Encoding ASCII
Write-Host "Built $zip ($sizeMb MB)" -ForegroundColor Green
Write-Host "SHA256 $hash"

if ($Publish) {
    $tag = "v$Version"
    $pre = if ([version]$Version -lt [version]'1.0.0') { '--prerelease' } else { $null }
    $notesFile = Join-Path $env:TEMP 'pob-agent-release\notes.md'
    Set-Content $notesFile ($notes + "`n`n**Install:** download the zip, extract it, double-click ``Install.cmd``. See the README.`n`nSHA256: ``$hash``") -Encoding UTF8
    & git -C $Root rev-parse -q --verify "refs/tags/$tag" *> $null
    if ($LASTEXITCODE -ne 0) { Run git @('-C', $Root, 'tag', '-a', $tag, '-m', "PoB Agent Edition $tag") }
    Run git @('-C', $Root, 'push', 'origin', $tag)
    $ghArgs = @('release', 'create', $tag, $zip, "$zip.sha256", '--title', "PoB Agent Edition $tag", '--notes-file', $notesFile)
    if ($pre) { $ghArgs += $pre }
    Push-Location $Root; try { Run gh $ghArgs } finally { Pop-Location }
}
