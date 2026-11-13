<#
.SYNOPSIS
  Builds the release zips (and optionally publishes a GitHub release).

.DESCRIPTION
  Uses only committed code: `git archive` of each repo, so uncommitted work and local files
  (builds, AgentEdition.json, settings) can never end up in a release.
  Steps: secret scan, export PathOfBuilding + root files (with agent-mcp), build the MCP server,
  drop dev dependencies, zip to dist\PoB-Agent-Edition-<version>-win64.zip.
  Then the portable version, dist\PoB-Agent-Edition-<version>-win64-portable.zip: the same files plus
  the official Node.js for Windows in node\ (pinned version, checked against nodejs.org's SHASUMS256)
  and the start / connect / disconnect scripts from portable\. Each zip gets a .sha256 file (LF line end,
  so `sha256sum -c` works on Linux and macOS too).
  The VERSION file must say <Version>.

  Lighter releases (Stage 17):
  - Tree packs: Ruthless, "alternate" and older passive trees are left out of both zips. PoB downloads one
    when a build needs it, from the fork's release tag agent-edition-v<version> on raw.githubusercontent.com
    (created and pushed with -Publish), checked against
    PathOfBuilding\src\TreeData\packs.json (size + SHA256 of every file). The fork commit must be pushed
    first (checked with -Publish).
  - Manifest: release-manifest.json (path, size, SHA256 of every file) goes into both zips and next to them
    as PoB-Agent-Edition-<version>-manifest.json.
  - Delta zips: PoB-Agent-Edition-<from>-to-<version>-update.zip holds only the files that changed since
    <from>. tools\update.ps1 uses it and falls back to the full zip when anything does not match.

.PARAMETER Version
  Version without "v", e.g. 0.1.0. Must have a section in CHANGELOG.md.

.PARAMETER Publish
  Also tag v<Version> and create a GitHub release with the changelog section as notes.
  It becomes the "Latest" release (shown in the repo sidebar), since 0.6.1 is the public beta.

.PARAMETER PreRelease
  Publish as a pre-release instead (for test builds): not shown as Latest on GitHub.
  The in-app updater still offers it.

.PARAMETER DeltaFrom
  Versions to make delta zips from. Default: the 3 newest earlier releases that have a manifest
  (on GitHub with -Publish, else in dist\).

.PARAMETER KeepTrees
  How many of the newest normal passive tree versions stay in the zips (default 3).

.PARAMETER NoPacks
  Keep every passive tree in the zips (no tree packs).
#>
param(
    [Parameter(Mandatory)][string]$Version,
    [switch]$Publish,
    [switch]$PreRelease,
    [string[]]$DeltaFrom,
    [int]$KeepTrees = 3,
    [switch]$NoPacks
)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Name = "PoB-Agent-Edition-$Version-win64"
$Dist = Join-Path $Root 'dist'
$Work = Join-Path $env:TEMP 'pob-agent-release'
$Stage = Join-Path $Work $Name
$PortableName = "$Name-portable"
$PortableStage = Join-Path $Work $PortableName
$ManifestName = "PoB-Agent-Edition-$Version-manifest.json"
# Node.js bundled in the portable zip: an LTS line, pinned. Update it deliberately (and test) between releases.
$NodeVersion = 'v24.22.3'
$NodeZipName = "node-$NodeVersion-win-x64.zip"
# Files inside a tree pack folder that other trees use too: they stay in the zips.
$SharedTreeFiles = @('3_19/Assets.lua')

$Tar = Join-Path $env:SystemRoot 'System32\tar.exe'  # Windows bsdtar (Git Bash's GNU tar misreads C: paths and cannot write zip)
# Arguments go in as one array: passing --flags through a PowerShell function's own parameters mangles them
function Run([string]$exe, [string[]]$argv) { & $exe @argv; if ($LASTEXITCODE -ne 0) { throw "$exe $($argv -join ' ') failed" } }
function Utf8NoBom() { New-Object Text.UTF8Encoding $false }
# "<hash>  <file>" with an LF line end: sha256sum -c on Linux/macOS rejects CRLF.
function Write-Sha256([string]$file) {
    $h = (Get-FileHash $file -Algorithm SHA256).Hash.ToLower()
    [IO.File]::WriteAllText("$file.sha256", "$h  $(Split-Path $file -Leaf)`n", [Text.Encoding]::ASCII)
    return $h
}
function Zip-Folder([string]$parent, [string]$folder, [string]$zip) {
    if (Test-Path $zip) { Remove-Item $zip -Force }
    Push-Location $parent
    try { Run $Tar @('-a', '-c', '-f', $zip, $folder) } finally { Pop-Location }
}
function Ver-Key([string]$v) { [version](($v -replace '^v', '') -replace '[^\d.].*$', '') }

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
$tarFile = Join-Path $Work 'part.tar'
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
$PortableScripts = Join-Path $Work 'portable-scripts'
if (Test-Path $PortableScripts) { Remove-Item $PortableScripts -Recurse -Force }
Move-Item (Join-Path $Stage 'portable') $PortableScripts

# Not needed by players
foreach ($p in @('PathOfBuilding\spec', 'PathOfBuilding\tests', 'PathOfBuilding\runtime-win32.zip', 'PathOfBuilding\.github',
                 'agent-mcp\tests', '.github')) {
    $full = Join-Path $Stage $p
    if (Test-Path $full) { Remove-Item $full -Recurse -Force }
}

# --- Tree packs ----------------------------------------------------------------------------------
if (-not $NoPacks) {
    $pobRepo = Join-Path $Root 'PathOfBuilding'
    $treeDir = Join-Path $Stage 'PathOfBuilding\src\TreeData'
    $vers = @(Get-ChildItem $treeDir -Directory | Where-Object { $_.Name -match '^\d+_\d+(_[a-z_]+)?$' })
    $normal = @($vers | Where-Object { $_.Name -match '^\d+_\d+$' } | Sort-Object { Ver-Key ($_.Name -replace '_', '.') })
    $keep = @($normal | Select-Object -Last $KeepTrees | ForEach-Object Name)
    $packIds = @($vers | Where-Object { $keep -notcontains $_.Name } | ForEach-Object Name)
    $pobCommit = (& git -C $pobRepo rev-parse HEAD).Trim()
    $originUrl = (& git -C $pobRepo remote get-url origin).Trim()
    $om = [regex]::Match($originUrl, 'github\.com[:/]([^/]+/[^/]+?)(\.git)?$')
    if (-not $om.Success) { throw "PathOfBuilding's origin ($originUrl) is not a GitHub repository: tree packs need one." }
    # Players download packs from a release tag on the fork: a tag keeps the commit reachable even if
    # the fork's branch is rebased later (a bare commit link then returns 404).
    $packTag = "agent-edition-v$Version"
    if ($Publish) {
        & git -C $pobRepo fetch origin --quiet
        if (-not (& git -C $pobRepo branch -r --contains $pobCommit)) { throw "PathOfBuilding $pobCommit is not pushed to origin: players could not download tree packs. Push the fork first." }
        & git -C $pobRepo rev-parse -q --verify "refs/tags/$packTag" *> $null
        if ($LASTEXITCODE -ne 0) { Run git @('-C', $pobRepo, 'tag', '-a', $packTag, '-m', "PoB Agent Edition v$Version (tree packs)", $pobCommit) }
        Run git @('-C', $pobRepo, 'push', 'origin', "refs/tags/$packTag")
    }
    Write-Host "Tree packs: keeping $($keep -join ', '); $($packIds.Count) versions become packs (fork $($om.Groups[1].Value) @ $($pobCommit.Substring(0, 9)))"
    # raw.githubusercontent.com serves the files as committed (LF), so hash an LF export, not the CRLF one.
    $lfDir = Join-Path $Work 'packs-lf'
    if (Test-Path $lfDir) { Remove-Item $lfDir -Recurse -Force }
    New-Item -ItemType Directory -Force $lfDir | Out-Null
    $lfTar = Join-Path $Work 'packs-lf.tar'
    Run git (@('-c', 'core.autocrlf=false', '-c', 'core.eol=lf', '-C', $pobRepo, 'archive', '--format=tar', '-o', $lfTar, 'HEAD', '--') + @($packIds | ForEach-Object { "src/TreeData/$_" }))
    Run $Tar @('-x', '-f', $lfTar, '-C', $lfDir)
    Remove-Item $lfTar -Force
    $packs = [ordered]@{}
    $packTotal = 0L
    foreach ($id in $packIds) {
        $base = Join-Path $lfDir "src\TreeData\$id"
        $files = @()
        $size = 0L
        foreach ($f in Get-ChildItem $base -Recurse -File | Sort-Object FullName) {
            $rel = $f.FullName.Substring($base.Length + 1).Replace('\', '/')
            $files += [ordered]@{ path = $rel; size = $f.Length; sha256 = (Get-FileHash $f.FullName -Algorithm SHA256).Hash.ToLower() }
            $size += $f.Length
        }
        $packs[$id] = [ordered]@{ size = $size; files = $files }
        $packTotal += $size
        # Remove the pack from the zips, except files other trees use too
        $dir = Join-Path $treeDir $id
        foreach ($f in Get-ChildItem $dir -Recurse -File) {
            $rel = "$id/" + $f.FullName.Substring($dir.Length + 1).Replace('\', '/')
            if ($SharedTreeFiles -notcontains $rel) { Remove-Item $f.FullName -Force }
        }
        Get-ChildItem $dir -Recurse -Directory | Sort-Object { $_.FullName.Length } -Descending | Where-Object { -not (Get-ChildItem $_.FullName -Force) } | Remove-Item -Force
        if (-not (Get-ChildItem $dir -Force)) { Remove-Item $dir -Force }
    }
    Remove-Item $lfDir -Recurse -Force
    $packsDoc = [ordered]@{
        version = 1
        release = $Version
        source = "https://raw.githubusercontent.com/$($om.Groups[1].Value)/refs/tags/$packTag/src/TreeData/"
        commit = $pobCommit
        packs = $packs
    }
    [IO.File]::WriteAllText((Join-Path $treeDir 'packs.json'), ($packsDoc | ConvertTo-Json -Depth 6 -Compress), (Utf8NoBom))
    Write-Host "  $([math]::Round($packTotal / 1MB)) MB of trees moved to packs"
}

# --- Portable version (staged now, zipped after the manifest) -----------------------------------
Write-Host "Portable version (Node.js $NodeVersion)..."
$nodeCache = Join-Path $Work 'node-cache'
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

# --- Manifest: every file of both zips (path, size, SHA256; "only" marks files of one zip) ----------
Write-Host 'Manifest...'
function List-Files([string]$dir) {
    $h = @{}
    foreach ($f in Get-ChildItem $dir -Recurse -File -Force) { $h[$f.FullName.Substring($dir.Length + 1).Replace('\', '/')] = $f }
    return $h
}
$zipFiles = List-Files $Stage
$portFiles = List-Files $PortableStage
$entries = New-Object System.Collections.Generic.List[object]
foreach ($rel in (@($zipFiles.Keys) + @($portFiles.Keys) | Sort-Object -Unique)) {
    if ($rel -eq 'release-manifest.json') { continue }
    $f = if ($portFiles.ContainsKey($rel)) { $portFiles[$rel] } else { $zipFiles[$rel] }
    $e = [ordered]@{ path = $rel; size = $f.Length; sha256 = (Get-FileHash $f.FullName -Algorithm SHA256).Hash.ToLower() }
    if (-not $zipFiles.ContainsKey($rel)) { $e['only'] = 'portable' } elseif (-not $portFiles.ContainsKey($rel)) { $e['only'] = 'zip' }
    $entries.Add($e)
}
$manifest = [ordered]@{ version = $Version; created = (Get-Date).ToUniversalTime().ToString('s') + 'Z'; files = $entries }
$manifestJson = $manifest | ConvertTo-Json -Depth 5 -Compress
foreach ($d in @($Stage, $PortableStage)) { [IO.File]::WriteAllText((Join-Path $d 'release-manifest.json'), $manifestJson, (Utf8NoBom)) }
New-Item -ItemType Directory -Force $Dist | Out-Null
$manifestFile = Join-Path $Dist $ManifestName
[IO.File]::WriteAllText($manifestFile, $manifestJson, (Utf8NoBom))
Write-Host "  $($entries.Count) files"

# --- Zips -------------------------------------------------------------------------------------------
Write-Host 'Zipping...'
$zip = Join-Path $Dist "$Name.zip"
Zip-Folder $Work $Name $zip
$hash = Write-Sha256 $zip
Write-Host "Built $zip ($([math]::Round((Get-Item $zip).Length / 1MB, 1)) MB)" -ForegroundColor Green
Write-Host "SHA256 $hash"
$pzip = Join-Path $Dist "$PortableName.zip"
Zip-Folder $Work $PortableName $pzip
$phash = Write-Sha256 $pzip
Write-Host "Built $pzip ($([math]::Round((Get-Item $pzip).Length / 1MB, 1)) MB)" -ForegroundColor Green
Write-Host "SHA256 $phash"
$null = Write-Sha256 $manifestFile

# --- Delta zips: only the files that changed since an earlier release -------------------------------
$deltaAssets = @()
$baseDir = Join-Path $Work 'base-manifests'
New-Item -ItemType Directory -Force $baseDir | Out-Null
if (-not $PSBoundParameters.ContainsKey('DeltaFrom')) {
    $DeltaFrom = @()
    if ($Publish) {
        try {
            $tags = @(& gh release list --repo "$($(& git -C $Root remote get-url origin) -replace '^.*github\.com[:/]', '' -replace '\.git$', '')" --limit 30 --json tagName --jq '.[].tagName')
            $DeltaFrom = @($tags | ForEach-Object { $_ -replace '^v', '' } | Where-Object { $_ -match '^\d+\.\d+\.\d+' -and (Ver-Key $_) -lt (Ver-Key $Version) })
        } catch { Write-Host "Note: could not list releases for deltas: $($_.Exception.Message)" -ForegroundColor Yellow }
    } else {
        $DeltaFrom = @(Get-ChildItem $Dist -Filter 'PoB-Agent-Edition-*-manifest.json' | ForEach-Object { $_.Name -replace '^PoB-Agent-Edition-(.+)-manifest\.json$', '$1' } |
                       Where-Object { $_ -ne $Version -and (Ver-Key $_) -lt (Ver-Key $Version) })
    }
    $DeltaFrom = @($DeltaFrom | Sort-Object { Ver-Key $_ } -Descending)
}
$made = 0
foreach ($from in $DeltaFrom) {
    if ($made -ge 3 -and -not $PSBoundParameters.ContainsKey('DeltaFrom')) { break }
    $bm = Join-Path $Dist "PoB-Agent-Edition-$from-manifest.json"
    if (-not (Test-Path $bm)) {
        $bm = Join-Path $baseDir "PoB-Agent-Edition-$from-manifest.json"
        if (-not (Test-Path $bm)) {
            & gh release download "v$from" --repo ((& git -C $Root remote get-url origin) -replace '^.*github\.com[:/]', '' -replace '\.git$', '') -p "PoB-Agent-Edition-$from-manifest.json" -D $baseDir 2>$null
        }
        if (-not (Test-Path $bm)) { Write-Host "  no manifest for $from (released before Stage 17): no delta from it" -ForegroundColor DarkGray; continue }
    }
    $old = @{}
    foreach ($e in (Get-Content $bm -Raw | ConvertFrom-Json).files) { $old[$e.path] = $e.sha256 }
    $deltaName = "PoB-Agent-Edition-$from-to-$Version-update"
    $deltaStage = Join-Path $Work $deltaName
    if (Test-Path $deltaStage) { Remove-Item $deltaStage -Recurse -Force }
    New-Item -ItemType Directory -Force $deltaStage | Out-Null
    $count = 0; $bytes = 0L
    foreach ($e in $entries) {
        if ($old[$e.path] -eq $e.sha256) { continue }
        $src = if ($portFiles.ContainsKey($e.path)) { $portFiles[$e.path].FullName } else { $zipFiles[$e.path].FullName }
        $dest = Join-Path $deltaStage ($e.path.Replace('/', '\'))
        New-Item -ItemType Directory -Force (Split-Path $dest) | Out-Null
        Copy-Item -LiteralPath $src $dest
        $count++; $bytes += $e.size
    }
    [IO.File]::WriteAllText((Join-Path $deltaStage 'release-manifest.json'), $manifestJson, (Utf8NoBom))
    [IO.File]::WriteAllText((Join-Path $deltaStage 'delta.json'), (([ordered]@{ from = $from; to = $Version; files = $count }) | ConvertTo-Json -Compress), (Utf8NoBom))
    $dzip = Join-Path $Dist "$deltaName.zip"
    Zip-Folder $Work $deltaName $dzip
    $null = Write-Sha256 $dzip
    Remove-Item $deltaStage -Recurse -Force
    Write-Host "Built ${dzip}: $count changed files ($([math]::Round($bytes / 1MB, 1)) MB unpacked, $([math]::Round((Get-Item $dzip).Length / 1MB, 1)) MB zip)" -ForegroundColor Green
    $deltaAssets += @($dzip, "$dzip.sha256")
    $made++
}

if ($Publish) {
    $tag = "v$Version"
    $pre = if ($PreRelease) { '--prerelease' } else { '--latest' }
    $notesFile = Join-Path $Work 'notes.md'
    # UTF-8 without BOM (PowerShell 5.1's -Encoding UTF8 adds one, which shows up in GitHub release notes)
    $install = "**Install:** download ``$Name.zip``, extract it, double-click ``Install.cmd`` (needs Node.js 20+, which it offers to install).`n" +
               "**Portable (no installer, no Node.js needed):** download ``$PortableName.zip``, extract it, double-click ``Start PoB Agent Edition.cmd``; ``Connect AI apps.cmd`` connects your AI app.`n" +
               "**Already installed?** Click **Update now** on the Overview banner, or run ``tools\update.ps1``: from 0.7.0 on it downloads only the changed files (the ``-update.zip``). See the README."
    [IO.File]::WriteAllText($notesFile, ($notes + "`n`n$install`n`nSHA256:`n- ``$Name.zip``: ``$hash```n- ``$PortableName.zip``: ``$phash``"), (Utf8NoBom))
    & git -C $Root rev-parse -q --verify "refs/tags/$tag" *> $null
    if ($LASTEXITCODE -ne 0) { Run git @('-C', $Root, 'tag', '-a', $tag, '-m', "PoB Agent Edition $tag") }
    Run git @('-C', $Root, 'push', 'origin', $tag)
    $ghArgs = @('release', 'create', $tag, $zip, "$zip.sha256", $pzip, "$pzip.sha256", $manifestFile, "$manifestFile.sha256") + $deltaAssets +
              @('--title', "PoB Agent Edition $tag", '--notes-file', $notesFile)
    if ($pre) { $ghArgs += $pre }
    Push-Location $Root; try { Run gh $ghArgs } finally { Pop-Location }
}
