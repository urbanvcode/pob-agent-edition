<#
.SYNOPSIS
  Builds the release zip (and optionally publishes a GitHub release).

.DESCRIPTION
  Uses only committed code: `git archive` of each repo, so uncommitted work and local files
  (builds, AgentEdition.json, settings) can never end up in a release.
  Steps: secret scan, export PathOfBuilding + root files (with agent-mcp), build the MCP server,
  drop dev dependencies, add LuaJIT, zip to dist\PoB-Agent-Edition-<version>-win64.zip.
  Then the portable version, dist\PoB-Agent-Edition-<version>-win64-portable.zip: the same files plus
  the official Node.js for Windows in node\ (pinned version, checked against nodejs.org's SHASUMS256)
  and the start / connect / disconnect scripts from portable\. Each zip gets a .sha256 file.
  The VERSION file must say <Version>.

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
$PortableName = "$Name-portable"
$PortableStage = Join-Path $env:TEMP "pob-agent-release\$PortableName"
# Node.js bundled in the portable zip: an LTS line, pinned. Update it deliberately (and test) between releases.
$NodeVersion = 'v24.22.3'
$NodeZipName = "node-$NodeVersion-win-x64.zip"

$Tar = Join-Path $env:SystemRoot 'System32\tar.exe'  # Windows bsdtar (Git Bash's GNU tar misreads C: paths and cannot write zip)
# Arguments go in as one array: passing --flags through a PowerShell function's own parameters mangles them
function Run([string]$exe, [string[]]$argv) { & $exe @argv; if ($LASTEXITCODE -ne 0) { throw "$exe $($argv -join ' ') failed" } }

$changelog = Get-Content (Join-Path $Root 'CHANGELOG.md') -Raw
$m = [regex]::Match($changelog, "(?ms)^## \[$([regex]::Escape($Version))\][^\n]*\n(.*?)(?=^## \[|^\[Unreleased\]:)")
if (-not $m.Success) { throw "CHANGELOG.md has no section '## [$Version]'." }
$notes = $m.Groups[1].Value.Trim()

$versionFile = (Get-Content (Join-Path $Root 'VERSION') -TotalCount 1).Trim()
if ($versionFile -ne $Version) { throw "VERSION says '$versionFile' but -Version is '$Version'. Set VERSION to $Version and commit it first." }
$pkgVersion = (Get-Content (Join-Path $Root 'agent-mcp\package.json') -Raw | ConvertFrom-Json).version
if ($pkgVersion -ne $Version) { Write-Host "Note: agent-mcp\package.json says $pkgVersion (VERSION is the source of truth; consider updating it)." -ForegroundColor Yellow }

& (Join-Path $PSScriptRoot 'check-secrets.ps1'); if ($LASTEXITCODE -ne 0) { throw 'Secret scan failed.' }

foreach ($r in @('PathOfBuilding')) {
    $dirty = & git -C (Join-Path $Root $r) status --porcelain --untracked-files=no
    if ($dirty) { Write-Host "Note: $r has uncommitted changes; they are NOT included (release uses committed code)." -ForegroundColor Yellow }
}

if (Test-Path $Stage) { Remove-Item $Stage -Recurse -Force }
New-Item -ItemType Directory -Force $Stage | Out-Null

Write-Host 'Exporting committed code...'
$tarFile = Join-Path $env:TEMP 'pob-agent-release\part.tar'
Run git @('-C', $Root, 'archive', '--format=tar', '-o', $tarFile, 'HEAD')
Run $Tar @('-x', '-f', $tarFile, '-C', $Stage)
foreach ($r in @('PathOfBuilding')) {
    $dest = Join-Path $Stage $r
    New-Item -ItemType Directory -Force $dest | Out-Null
    Run git @('-C', (Join-Path $Root $r), 'archive', '--format=tar', '-o', $tarFile, 'HEAD')
    Run $Tar @('-x', '-f', $tarFile, '-C', $dest)
}
Remove-Item $tarFile -Force

Write-Host 'Building the MCP server...'
Push-Location (Join-Path $Stage 'agent-mcp')
try {
    Run npm @('ci', '--no-audit', '--no-fund')
    Run npm @('run', 'build')
    Run npm @('prune', '--omit=dev', '--no-audit', '--no-fund')
} finally { Pop-Location }

# The portable version's scripts (committed copy) go to its root later, not into the normal zip
$PortableScripts = Join-Path $env:TEMP 'pob-agent-release\portable-scripts'
if (Test-Path $PortableScripts) { Remove-Item $PortableScripts -Recurse -Force }
Move-Item (Join-Path $Stage 'portable') $PortableScripts

# Not needed by players
foreach ($p in @('PathOfBuilding\spec', 'PathOfBuilding\tests', 'PathOfBuilding\runtime-win32.zip', 'PathOfBuilding\.github',
                 'agent-mcp\tests', '.github')) {
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

# --- Portable version ---------------------------------------------------------------------------
Write-Host "Portable version (Node.js $NodeVersion)..."
$nodeCache = Join-Path $env:TEMP 'pob-agent-release\node-cache'
New-Item -ItemType Directory -Force $nodeCache | Out-Null
$nodeZip = Join-Path $nodeCache $NodeZipName
$sums = Join-Path $nodeCache "SHASUMS256-$NodeVersion.txt"
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
$ProgressPreference = 'SilentlyContinue'
Invoke-WebRequest "https://nodejs.org/dist/$NodeVersion/SHASUMS256.txt" -OutFile $sums -UseBasicParsing
if (-not (Test-Path $nodeZip)) { Invoke-WebRequest "https://nodejs.org/dist/$NodeVersion/$NodeZipName" -OutFile $nodeZip -UseBasicParsing }
$line = Get-Content $sums | Where-Object { $_ -match "\s$([regex]::Escape($NodeZipName))$" } | Select-Object -First 1
if (-not $line) { throw "SHASUMS256.txt of Node.js $NodeVersion has no $NodeZipName." }
$nodeExpected = ($line -split '\s+')[0].ToLower()
$nodeActual = (Get-FileHash $nodeZip -Algorithm SHA256).Hash.ToLower()
if ($nodeExpected -ne $nodeActual) { Remove-Item $nodeZip -Force; throw "Node.js zip SHA256 mismatch (expected $nodeExpected, got $nodeActual)." }
Write-Host "Node.js zip verified against nodejs.org SHASUMS256 ($nodeActual)"

if (Test-Path $PortableStage) { Remove-Item $PortableStage -Recurse -Force }
& robocopy.exe $Stage $PortableStage /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "Copying the release folder for the portable version failed (robocopy $LASTEXITCODE)." }
Remove-Item (Join-Path $PortableStage 'Install.cmd') -Force   # the portable version installs nothing
foreach ($f in Get-ChildItem $PortableScripts -Filter '*.cmd') { Copy-Item $f.FullName $PortableStage }
$nodeDir = Join-Path $PortableStage 'node'
New-Item -ItemType Directory -Force $nodeDir | Out-Null
$nodeTop = "node-$NodeVersion-win-x64"
Run $Tar @('-x', '-f', $nodeZip, '-C', $nodeCache, "$nodeTop/node.exe", "$nodeTop/LICENSE")
Copy-Item (Join-Path $nodeCache "$nodeTop\node.exe") $nodeDir -Force
Copy-Item (Join-Path $nodeCache "$nodeTop\LICENSE") $nodeDir -Force
Set-Content (Join-Path $nodeDir 'VERSION.txt') "Node.js $NodeVersion (official Windows x64 build from https://nodejs.org/dist/$NodeVersion/, MIT licence: LICENSE)" -Encoding ASCII
$pzip = Join-Path $Dist "$PortableName.zip"
if (Test-Path $pzip) { Remove-Item $pzip -Force }
Push-Location (Split-Path $PortableStage)
try { Run $Tar @('-a', '-c', '-f', $pzip, $PortableName) } finally { Pop-Location }
$psizeMb = [math]::Round((Get-Item $pzip).Length / 1MB, 1)
$phash = (Get-FileHash $pzip -Algorithm SHA256).Hash.ToLower()
Set-Content "$pzip.sha256" "$phash  $PortableName.zip" -Encoding ASCII
Write-Host "Built $pzip ($psizeMb MB)" -ForegroundColor Green
Write-Host "SHA256 $phash"

if ($Publish) {
    $tag = "v$Version"
    $pre = if ([version]$Version -lt [version]'1.0.0') { '--prerelease' } else { $null }
    $notesFile = Join-Path $env:TEMP 'pob-agent-release\notes.md'
    # UTF-8 without BOM (PowerShell 5.1's -Encoding UTF8 adds one, which shows up in GitHub release notes)
    $install = "**Install:** download ``$Name.zip``, extract it, double-click ``Install.cmd`` (needs Node.js 20+, which it offers to install).`n" +
               "**Portable (no installer, no Node.js needed):** download ``$PortableName.zip``, extract it, double-click ``Start PoB Agent Edition.cmd``; ``Connect AI apps.cmd`` connects your AI app.`n" +
               "**Already installed?** Click **Update now** on the Overview banner, or run ``tools\update.ps1``. See the README."
    [IO.File]::WriteAllText($notesFile, ($notes + "`n`n$install`n`nSHA256:`n- ``$Name.zip``: ``$hash```n- ``$PortableName.zip``: ``$phash``"), (New-Object Text.UTF8Encoding $false))
    & git -C $Root rev-parse -q --verify "refs/tags/$tag" *> $null
    if ($LASTEXITCODE -ne 0) { Run git @('-C', $Root, 'tag', '-a', $tag, '-m', "PoB Agent Edition $tag") }
    Run git @('-C', $Root, 'push', 'origin', $tag)
    $ghArgs = @('release', 'create', $tag, $zip, "$zip.sha256", $pzip, "$pzip.sha256", '--title', "PoB Agent Edition $tag", '--notes-file', $notesFile)
    if ($pre) { $ghArgs += $pre }
    Push-Location $Root; try { Run gh $ghArgs } finally { Pop-Location }
}
