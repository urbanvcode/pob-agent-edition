<#
.SYNOPSIS
  Installs PoB Agent Edition: shortcuts plus the "pob" MCP server for your AI apps.

.DESCRIPTION
  Run it from the extracted release folder (or a git checkout), usually through Install.cmd.
  - Checks Node.js 20+ and offers to install it with winget if it is missing.
  - Builds the MCP server if this is a source checkout (agent-mcp\build missing).
  - Creates Start menu and desktop shortcuts for PoB Agent Edition.
  - Adds the "pob" MCP server to Claude Desktop, Claude Code and Codex when they are installed.
  - Writes mcp-config.json for any other MCP client.
  Nothing is sent anywhere. Existing AI app config files are backed up (*.bak) before changing.

.PARAMETER Uninstall
  Removes the shortcuts and the "pob" MCP entries. Builds and settings are not touched.

.PARAMETER NoDesktopShortcut
  Only create the Start menu shortcut.

.PARAMETER BuildsDir
  Path of Building builds folder. Default: Documents\Path of Building\Builds.
#>
param(
    [switch]$Uninstall,
    [switch]$NoDesktopShortcut,
    [string]$BuildsDir
)

$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot
$AppName = 'PoB Agent Edition'
$PobExe = Join-Path $Root 'PathOfBuilding\runtime\Path{space}of{space}Building.exe'
$PobExeAlt = Join-Path $Root 'PathOfBuilding\runtime\Path of Building.exe'
$McpDir = Join-Path $Root 'agent-mcp'
$McpEntry = Join-Path $McpDir 'build\index.js'
$LuaJit = Join-Path $Root 'luajit\luajit.exe'
$PobSrc = Join-Path $Root 'PathOfBuilding\src'
if (-not $BuildsDir) { $BuildsDir = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Path of Building\Builds' }

function Say($msg, $color = 'Gray') { Write-Host $msg -ForegroundColor $color }
function Ok($msg) { Say "  [ok] $msg" Green }
function Warn($msg) { Say "  [!]  $msg" Yellow }
function Fwd($p) { $p -replace '\\', '/' }

$StartMenuLnk = Join-Path ([Environment]::GetFolderPath('Programs')) "$AppName.lnk"
$DesktopLnk = Join-Path ([Environment]::GetFolderPath('Desktop')) "$AppName.lnk"

# --- AI app config locations ------------------------------------------------------------
$ClaudeDesktopConfigs = @()
if ($env:APPDATA -and (Test-Path (Join-Path $env:APPDATA 'Claude'))) {
    $ClaudeDesktopConfigs += Join-Path $env:APPDATA 'Claude\claude_desktop_config.json'
}
# Microsoft Store build of Claude Desktop keeps its config in a package folder
Get-ChildItem (Join-Path $env:LOCALAPPDATA 'Packages') -Directory -Filter 'Claude_*' -ErrorAction SilentlyContinue | ForEach-Object {
    $d = Join-Path $_.FullName 'LocalCache\Roaming\Claude'
    if (Test-Path $d) { $ClaudeDesktopConfigs += Join-Path $d 'claude_desktop_config.json' }
}
$CodexDir = Join-Path $env:USERPROFILE '.codex'
$CodexConfig = Join-Path $CodexDir 'config.toml'
$HasClaudeCli = [bool](Get-Command claude -ErrorAction SilentlyContinue)
# Claude Code inside the Claude desktop app has no `claude` command; its user config is this file
$ClaudeCodeConfig = Join-Path $env:USERPROFILE '.claude.json'

# Sets (or with no entry: removes) mcpServers.pob in Claude Code's config. Done with Node so the
# large file is rewritten exactly (PowerShell 5.1's JSON round trip changes it).
function Set-ClaudeCodePob($entryJson) {
    $env:POB_CC_FILE = $ClaudeCodeConfig
    $env:POB_CC_ENTRY = $entryJson
    $js = 'const fs=require("fs");const f=process.env.POB_CC_FILE;const j=JSON.parse(fs.readFileSync(f,"utf8"));j.mcpServers=j.mcpServers||{};if(process.env.POB_CC_ENTRY){j.mcpServers.pob=JSON.parse(process.env.POB_CC_ENTRY)}else{delete j.mcpServers.pob}fs.writeFileSync(f,JSON.stringify(j,null,2));'
    & node -e $js
    $ok = $LASTEXITCODE -eq 0
    $env:POB_CC_FILE = $null; $env:POB_CC_ENTRY = $null
    return $ok
}

function Backup($file) { if (Test-Path $file) { Copy-Item $file "$file.bak" -Force } }

function Read-JsonFile($file) {
    if (-not (Test-Path $file)) { return [pscustomobject]@{} }
    $raw = Get-Content $file -Raw -Encoding UTF8
    if (-not $raw -or -not $raw.Trim()) { return [pscustomobject]@{} }
    return $raw | ConvertFrom-Json
}

function Write-JsonFile($file, $obj) {
    $json = $obj | ConvertTo-Json -Depth 32
    [IO.File]::WriteAllText($file, $json, (New-Object Text.UTF8Encoding $false))
}

function Write-TextFile($file, $text) {
    # UTF-8 without BOM (Windows PowerShell 5.1's Set-Content -Encoding UTF8 adds one, which TOML parsers may reject)
    [IO.File]::WriteAllText($file, $text, (New-Object Text.UTF8Encoding $false))
}

function Remove-CodexPob($text) {
    # Drop [mcp_servers.pob] and [mcp_servers.pob.*] tables
    $out = New-Object System.Collections.Generic.List[string]
    $skip = $false
    foreach ($line in ($text -split "`r?`n")) {
        if ($line -match '^\s*\[') { $skip = $line -match '^\s*\[mcp_servers\.pob(\.[^\]]*)?\]\s*$' }
        if (-not $skip) { $out.Add($line) }
    }
    return (($out -join "`r`n").TrimEnd() + "`r`n")
}

# --- Uninstall ------------------------------------------------------------------------------
if ($Uninstall) {
    Say "Removing $AppName integration..." Cyan
    foreach ($l in @($StartMenuLnk, $DesktopLnk)) { if (Test-Path $l) { Remove-Item $l -Force; Ok "removed $l" } }
    foreach ($cfg in $ClaudeDesktopConfigs) {
        if (Test-Path $cfg) {
            $j = Read-JsonFile $cfg
            if ($j.mcpServers -and $j.mcpServers.PSObject.Properties['pob']) {
                Backup $cfg; $j.mcpServers.PSObject.Properties.Remove('pob'); Write-JsonFile $cfg $j; Ok "Claude Desktop: removed pob"
            }
        }
    }
    if ($HasClaudeCli) { & claude mcp remove pob --scope user *> $null; Ok "Claude Code: removed pob (if it was there)" }
    elseif ((Test-Path $ClaudeCodeConfig) -and (Get-Command node -ErrorAction SilentlyContinue)) {
        Backup $ClaudeCodeConfig
        if (Set-ClaudeCodePob '') { Ok "Claude Code: removed pob" } else { Warn "Claude Code: could not edit $ClaudeCodeConfig" }
    }
    if (Test-Path $CodexConfig) { Backup $CodexConfig; Write-TextFile $CodexConfig (Remove-CodexPob (Get-Content $CodexConfig -Raw -Encoding UTF8)); Ok "Codex: removed pob" }
    Say "Done. You can delete this folder now; your builds are not touched." Green
    exit 0
}

Say "Installing $AppName from $Root" Cyan

# --- Layout check ---------------------------------------------------------------------------
if (-not (Test-Path $PobExe)) { if (Test-Path $PobExeAlt) { $PobExe = $PobExeAlt } else { throw "PathOfBuilding\runtime is missing. Extract the whole release zip (or clone with --recurse-submodules)." } }
if (-not (Test-Path $LuaJit)) { throw "luajit\luajit.exe is missing. Extract the whole release zip." }
if ($Root -match '[^\x00-\x7F]') { Warn "The folder path has non-English characters. If PoB fails to start, move the folder to e.g. C:\Games\$AppName." }

# --- Node.js --------------------------------------------------------------------------------
$node = Get-Command node -ErrorAction SilentlyContinue
$nodeOk = $false
if ($node) {
    $v = (& node --version).TrimStart('v')
    $nodeOk = ([version]($v -replace '-.*$', '')) -ge [version]'20.0.0'
    if ($nodeOk) { Ok "Node.js $v" } else { Warn "Node.js $v is too old (20 or newer needed)." }
}
if (-not $nodeOk) {
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if ($winget) {
        $answer = Read-Host "Install Node.js LTS now with winget? [Y/n]"
        if ($answer -eq '' -or $answer -match '^[yY]') {
            & winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements
            $env:PATH = [Environment]::GetEnvironmentVariable('PATH', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('PATH', 'User')
            $node = Get-Command node -ErrorAction SilentlyContinue
        }
    }
    if (-not $node) { throw "Node.js 20+ is required. Install the LTS version from https://nodejs.org/ and run Install.cmd again." }
}
$NodeExe = (Get-Command node).Source

# --- MCP server build (source checkouts only) ------------------------------------------------
if (-not (Test-Path $McpEntry)) {
    Say "Building the MCP server (first run from source)..."
    Push-Location $McpDir
    try {
        & npm ci; if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' }
        & npm run build; if ($LASTEXITCODE -ne 0) { throw 'npm run build failed' }
    } finally { Pop-Location }
}
Ok "MCP server: $McpEntry"

# --- Shortcuts ------------------------------------------------------------------------------
$shell = New-Object -ComObject WScript.Shell
$targets = @($StartMenuLnk); if (-not $NoDesktopShortcut) { $targets += $DesktopLnk }
foreach ($l in $targets) {
    $s = $shell.CreateShortcut($l)
    $s.TargetPath = $PobExe
    $s.WorkingDirectory = Split-Path $PobExe
    $s.Description = 'Path of Building with AI (MCP) support'
    $s.Save()
    Ok "shortcut: $l"
}

# --- MCP server entry -----------------------------------------------------------------------
# The server finds PoB and LuaJIT next to itself; only the Builds folder is passed (Documents may be redirected).
$envVars = [ordered]@{
    POB_DIRECTORY = (Fwd $BuildsDir)
}
$server = [ordered]@{ command = 'node'; args = @((Fwd $McpEntry)); env = $envVars }

# mcp-config.json for any other client (contains only local paths, no secrets)
Write-JsonFile (Join-Path $Root 'mcp-config.json') ([ordered]@{ mcpServers = [ordered]@{ pob = $server } })
Ok "mcp-config.json written (for other MCP apps)"

# Claude Desktop
foreach ($cfg in $ClaudeDesktopConfigs) {
    Backup $cfg
    $j = Read-JsonFile $cfg
    if (-not $j.PSObject.Properties['mcpServers']) { $j | Add-Member -NotePropertyName mcpServers -NotePropertyValue ([pscustomobject]@{}) }
    $j.mcpServers | Add-Member -NotePropertyName pob -NotePropertyValue ([pscustomobject]$server) -Force
    New-Item -ItemType Directory -Force (Split-Path $cfg) | Out-Null
    Write-JsonFile $cfg $j
    Ok "Claude Desktop: $cfg"
}
if (-not $ClaudeDesktopConfigs) { Say "  [-]  Claude Desktop not found (skipped)" }

# Claude Code
if ($HasClaudeCli) {
    $json = ([ordered]@{ type = 'stdio'; command = 'node'; args = @((Fwd $McpEntry)); env = $envVars } | ConvertTo-Json -Depth 8 -Compress)
    & claude mcp remove pob --scope user *> $null
    & claude mcp add-json pob $json --scope user
    if ($LASTEXITCODE -eq 0) { Ok "Claude Code: added 'pob' (user scope)" } else { Warn "Claude Code: could not add. Run: claude mcp add-json pob (see mcp-config.json)" }
} elseif (Test-Path $ClaudeCodeConfig) {
    Backup $ClaudeCodeConfig
    $json = ([ordered]@{ type = 'stdio'; command = 'node'; args = @((Fwd $McpEntry)); env = $envVars } | ConvertTo-Json -Depth 8 -Compress)
    if (Set-ClaudeCodePob $json) { Ok "Claude Code: added 'pob' ($ClaudeCodeConfig)" } else { Warn "Claude Code: could not edit $ClaudeCodeConfig (see mcp-config.json)" }
} else { Say "  [-]  Claude Code not found (skipped)" }

# Codex
if (Test-Path $CodexDir) {
    Backup $CodexConfig
    $text = if (Test-Path $CodexConfig) { Remove-CodexPob (Get-Content $CodexConfig -Raw -Encoding UTF8) } else { '' }
    $toml = @()
    $toml += ''
    $toml += '[mcp_servers.pob]'
    $toml += 'command = "node"'
    $toml += "args = [""$(Fwd $McpEntry)""]"
    $toml += ''
    $toml += '[mcp_servers.pob.env]'
    foreach ($k in $envVars.Keys) { $toml += "$k = ""$($envVars[$k])""" }
    Write-TextFile $CodexConfig ($text + ($toml -join "`r`n") + "`r`n")
    Ok "Codex: $CodexConfig"
} else { Say "  [-]  Codex not found (skipped)" }

Say ""
Say "Done! Next steps:" Green
Say "  1. Restart your AI app."
Say "  2. Open '$AppName' from the Start menu and load a build."
Say "  3. Ask the AI: ""Check my build in PoB: what's wrong with it?"""
Say "  Trade searches: paste your POESESSID in PoB Agent Edition > Options (never in a chat)."
if (Test-Path (Join-Path $Root 'pob-mcp')) { Say "  Note: the old 'pob-mcp' folder is no longer used; you can delete it." }
