<#
.SYNOPSIS
  Measures how heavy PoB Agent Edition is: downloads, disk, RAM and CPU (Stage 17).

.DESCRIPTION
  Prints one table per part and, with -Json, writes all numbers to a file so before/after runs can be
  compared (-Compare). It only reads: no settings, builds or caches are changed.
  - Downloads: release asset sizes from GitHub (-Release) and/or local zips (-Zip).
  - Unpacked: size per program folder of an install (-Root, default this checkout; .git folders skipped).
    Tree versions are split into "current" (in the default zip) and "packs" (Ruthless, alternate and old trees).
  - Processes started from -Root: the PoB window, the agent-mcp server (node) and headless engines (luajit):
    working set, private memory and CPU (% of one core) over -Seconds.
  - User data: Builds and each AgentCache folder in Documents\Path of Building (or the portable UserData),
    and the updater's "<folder>.previous" backup.

.PARAMETER Root      Install folder to measure (default: the folder above tools\).
.PARAMETER Release   GitHub release version(s) whose download sizes are listed, e.g. 0.6.1.
.PARAMETER Zip       Local zip file(s) to list.
.PARAMETER Seconds   CPU sampling time (default 10). 0 skips the process part.
.PARAMETER Json      Write the numbers to this JSON file.
.PARAMETER Compare   An earlier -Json file: shows before -> after for every number.
.PARAMETER Repo      GitHub repository (default urbanvcode/pob-agent-edition).
#>
param(
    [string]$Root,
    [string[]]$Release = @(),
    [string[]]$Zip = @(),
    [int]$Seconds = 10,
    [string]$Json,
    [string]$Compare,
    [string]$UserData,
    [string]$Repo = 'urbanvcode/pob-agent-edition'
)
$ErrorActionPreference = 'Stop'
if (-not $Root) { $Root = Split-Path -Parent $PSScriptRoot }
$Root = (Resolve-Path $Root).Path.TrimEnd('\')
$result = [ordered]@{ measured = (Get-Date).ToString('s'); root = '<root>'; downloads = [ordered]@{}; unpacked = [ordered]@{}; processes = [ordered]@{}; userdata = [ordered]@{} }

function Mb([double]$bytes) { [math]::Round($bytes / 1MB, 1) }
function Size-Of([string]$path, [string[]]$skipDirs = @('.git', 'node_modules\.cache')) {
    if (-not (Test-Path -LiteralPath $path)) { return 0 }
    $item = Get-Item -LiteralPath $path -Force
    if (-not $item.PSIsContainer) { return $item.Length }
    $sum = 0L
    $stack = New-Object System.Collections.Stack
    $stack.Push($item.FullName)
    while ($stack.Count) {
        $dir = $stack.Pop()
        try { $entries = [IO.Directory]::EnumerateFileSystemEntries($dir) } catch { continue }
        foreach ($e in $entries) {
            $attr = [IO.File]::GetAttributes($e)
            if ($attr -band [IO.FileAttributes]::Directory) {
                if ($attr -band [IO.FileAttributes]::ReparsePoint) { continue }
                if ($skipDirs -contains (Split-Path $e -Leaf)) { continue }
                $stack.Push($e)
            } else { $sum += (New-Object IO.FileInfo $e).Length }
        }
    }
    return $sum
}
function Row($table, $name, $value, $unit = 'MB') { $table[$name] = $value; [pscustomobject]@{ Part = $name; Value = $value; Unit = $unit } }

# --- Downloads -----------------------------------------------------------------------------------
$rows = @()
foreach ($v in $Release) {
    try {
        $rel = Invoke-RestMethod "https://api.github.com/repos/$Repo/releases/tags/v$($v -replace '^v','')" -Headers @{ 'User-Agent' = 'pob-agent-edition-measure' } -TimeoutSec 30
        foreach ($a in $rel.assets | Where-Object { $_.name -notmatch '\.sha256$' }) { $rows += Row $result.downloads $a.name (Mb $a.size) }
    } catch { Write-Host "Release v${v}: $($_.Exception.Message)" -ForegroundColor Yellow }
}
foreach ($z in $Zip) { foreach ($f in Get-Item $z) { $rows += Row $result.downloads $f.Name (Mb $f.Length) } }
if ($rows) { Write-Host "`nDownloads" -ForegroundColor Cyan; $rows | Format-Table -AutoSize | Out-String -Width 200 | Write-Host }

# --- Unpacked ------------------------------------------------------------------------------------
# Which tree versions are "packs" follows the release: TreeData\packs.json when present, else the rule
# build-release.ps1 uses (Ruthless, alternate, and all but the newest 3 normal versions).
$treeDir = Join-Path $Root 'PathOfBuilding\src\TreeData'
$packIds = @()
$packsJson = Join-Path $treeDir 'packs.json'
if (Test-Path $packsJson) { $packIds = @((Get-Content $packsJson -Raw | ConvertFrom-Json).packs.PSObject.Properties.Name) }
$treeVers = @(Get-ChildItem $treeDir -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '^\d+_\d+' })
if (-not (Test-Path $packsJson)) {
    $normal = @($treeVers | Where-Object { $_.Name -match '^\d+_\d+$' } | Sort-Object { [version]($_.Name -replace '_', '.') })
    $keep = @($normal | Select-Object -Last 3 | ForEach-Object Name)
    $packIds = @($treeVers | Where-Object { $keep -notcontains $_.Name } | ForEach-Object Name)
}
$treePack = 0L; $treeCur = 0L; $installedPacks = 0
foreach ($t in $treeVers) {
    $s = Size-Of $t.FullName
    if ($packIds -contains $t.Name) { $treePack += $s; if (Test-Path (Join-Path $t.FullName 'tree.lua')) { $installedPacks++ } } else { $treeCur += $s }
}
$rows = @()
$rows += Row $result.unpacked 'TreeData: current trees' (Mb $treeCur)
$rows += Row $result.unpacked "TreeData: pack trees installed ($installedPacks of $($packIds.Count))" (Mb $treePack)
$rows += Row $result.unpacked 'TreeData: shared images, Atlas, legion' (Mb ((Size-Of $treeDir) - $treeCur - $treePack))
$rows += Row $result.unpacked 'src\Data (timeless jewel tables etc.)' (Mb (Size-Of (Join-Path $Root 'PathOfBuilding\src\Data')))
$bins = @(Get-ChildItem (Join-Path $Root 'PathOfBuilding\src\Data\TimelessJewelData') -Filter '*.bin' -ErrorAction SilentlyContinue)
$rows += Row $result.unpacked "  of it unpacked jewel caches ($($bins.Count) .bin)" (Mb (($bins | Measure-Object Length -Sum).Sum))
$rows += Row $result.unpacked 'src other (Lua code, Assets...)' (Mb ((Size-Of (Join-Path $Root 'PathOfBuilding\src')) - (Size-Of $treeDir) - (Size-Of (Join-Path $Root 'PathOfBuilding\src\Data'))))
$rows += Row $result.unpacked 'PathOfBuilding\runtime' (Mb (Size-Of (Join-Path $Root 'PathOfBuilding\runtime')))
$rows += Row $result.unpacked 'agent-mcp' (Mb (Size-Of (Join-Path $Root 'agent-mcp')))
$rows += Row $result.unpacked 'node (portable)' (Mb (Size-Of (Join-Path $Root 'node')))
$rows += Row $result.unpacked 'Total (without .git)' (Mb (Size-Of $Root @('.git', 'dist', 'UserData')))
Write-Host "`nUnpacked install ($Root)" -ForegroundColor Cyan; $rows | Format-Table -AutoSize | Out-String -Width 200 | Write-Host

# --- Processes -----------------------------------------------------------------------------------
if ($Seconds -gt 0) {
    $prefix = "$Root\"
    $procs = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
        ($_.ExecutablePath -and $_.ExecutablePath.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) -or
        ($_.CommandLine -and $_.CommandLine.Replace('/', '\').IndexOf("$Root\agent-mcp", [StringComparison]::OrdinalIgnoreCase) -ge 0)
    })
    function Kind($p) {
        if ($p.Name -like 'Path*') { return 'PoB window' }
        if ($p.Name -like 'luajit*') { return 'headless engine' }
        if ($p.Name -like 'node*') { return 'agent-mcp (node)' }
        return $p.Name
    }
    $cores = [Environment]::ProcessorCount
    $start = @{}
    foreach ($p in $procs) { try { $start[$p.ProcessId] = (Get-Process -Id $p.ProcessId).TotalProcessorTime } catch {} }
    if ($procs) { Start-Sleep -Seconds $Seconds }
    $rows = @()
    foreach ($p in $procs) {
        try { $gp = Get-Process -Id $p.ProcessId } catch { continue }
        $cpu = [math]::Round(100 * ($gp.TotalProcessorTime - $start[$p.ProcessId]).TotalSeconds / $Seconds, 1)
        $k = "$(Kind $p) (pid $($p.ProcessId))"
        $result.processes[$k] = [ordered]@{ workingSetMb = (Mb $gp.WorkingSet64); privateMb = (Mb $gp.PrivateMemorySize64); cpuPctOfCore = $cpu }
        $rows += [pscustomobject]@{ Process = $k; 'Working set MB' = (Mb $gp.WorkingSet64); 'Private MB' = (Mb $gp.PrivateMemorySize64); 'CPU % of a core' = $cpu }
    }
    Write-Host "`nProcesses started from this folder (CPU over $Seconds s, $cores logical cores)" -ForegroundColor Cyan
    if ($rows) { $rows | Format-Table -AutoSize | Out-String -Width 200 | Write-Host } else { Write-Host '  (none running)' }
}

# --- User data -----------------------------------------------------------------------------------
if (-not $UserData) {
    $UserData = if (Test-Path (Join-Path $Root 'portable.txt')) { Join-Path $Root 'UserData' } else { Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Path of Building' }
}
$rows = @()
if (Test-Path $UserData) {
    $rows += Row $result.userdata 'Builds' (Mb (Size-Of (Join-Path $UserData 'Builds')))
    $cache = Join-Path $UserData 'AgentCache'
    foreach ($d in @(Get-ChildItem $cache -Directory -ErrorAction SilentlyContinue)) { $rows += Row $result.userdata "AgentCache\$($d.Name)" (Mb (Size-Of $d.FullName)) }
    $rows += Row $result.userdata 'AgentCache total' (Mb (Size-Of $cache))
}
$rows += Row $result.userdata 'Updater backup (<folder>.previous)' (Mb (Size-Of "$Root.previous"))
Write-Host "`nUser data and backups" -ForegroundColor Cyan; $rows | Format-Table -AutoSize | Out-String -Width 200 | Write-Host

if ($Json) { [IO.File]::WriteAllText($Json, ($result | ConvertTo-Json -Depth 6), (New-Object Text.UTF8Encoding $false)); Write-Host "Saved $Json" -ForegroundColor Green }

if ($Compare) {
    $old = Get-Content $Compare -Raw | ConvertFrom-Json
    Write-Host "`nBefore ($($old.measured)) -> now" -ForegroundColor Cyan
    foreach ($section in @('downloads', 'unpacked', 'userdata')) {
        foreach ($p in $old.$section.PSObject.Properties) {
            $now = $result[$section][$p.Name]
            Write-Host ("  {0,-50} {1,8} -> {2,8}" -f "$section/$($p.Name)", $p.Value, $(if ($null -ne $now) { $now } else { '-' }))
        }
    }
}
