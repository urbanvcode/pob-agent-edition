<#
.SYNOPSIS
  Scans what would be pushed for secrets and personal data.

.DESCRIPTION
  For the root repo and the PathOfBuilding submodule it checks:
  - files in the git index (what a commit contains) for session IDs, tokens, private keys,
    your Windows user folder path and your personal git e-mail;
  - author/committer e-mails of commits not yet on the remote (should be a GitHub no-reply address).
  Exits with code 1 if anything is found. Run it before every push and release.
#>
$ErrorActionPreference = 'Continue'  # git writes warnings to stderr; failures are checked by exit code
$Root = Split-Path -Parent $PSScriptRoot
$repos = @($Root, (Join-Path $Root 'PathOfBuilding'))

$patterns = @(
    # no quote characters here: Windows PowerShell 5.1 mangles them in native arguments
    'POESESSID[^0-9a-zA-Z]{1,6}[0-9a-fA-F]{32}',
    'POE_SESSION_ID[^0-9a-zA-Z]{1,6}[0-9a-fA-F]{32}',
    'gh[pousr]_[A-Za-z0-9]{30,}',
    'github_pat_[A-Za-z0-9_]{40,}',
    'sk-ant-[A-Za-z0-9_-]{20,}',
    'sk-(proj-)?[A-Za-z0-9]{32,}',
    'AKIA[0-9A-Z]{16}',
    '-----BEGIN [A-Z ]*PRIVATE KEY-----'
)
$personal = @()
if ($env:USERNAME) { $personal += [regex]::Escape("Users\$env:USERNAME"); $personal += [regex]::Escape("Users/$env:USERNAME") }
$globalMail = (& git config --global user.email 2>$null)
if ($globalMail -and $globalMail -notmatch 'noreply') { $personal += [regex]::Escape($globalMail) }

$found = 0
foreach ($repo in $repos) {
    if (-not (Test-Path (Join-Path $repo '.git'))) { continue }
    $name = Split-Path $repo -Leaf
    foreach ($p in ($patterns + $personal)) {
        $hits = & git -C $repo grep --cached -nIE -e $p -- ':!*.lock' ':!package-lock.json' 2>$null
        foreach ($h in $hits) {
            # Show where, never the value itself
            $where = ($h -split ':', 3)[0..1] -join ':'
            Write-Host "[$name] possible secret/personal data at $where (pattern: $p)" -ForegroundColor Red
            $found++
        }
    }
    & git -C $repo rev-parse -q --verify HEAD *> $null
    if ($LASTEXITCODE -ne 0) { continue }  # no commits yet
    $branch = (& git -C $repo rev-parse --abbrev-ref HEAD).Trim()
    $remoteRef = "origin/$branch"
    & git -C $repo rev-parse -q --verify $remoteRef *> $null
    $range = if ($LASTEXITCODE -eq 0) { "$remoteRef..HEAD" } else { 'HEAD' }
    $mails = & git -C $repo log --format='%ae%n%ce' $range 2>$null | Sort-Object -Unique
    foreach ($m in $mails) {
        if ($globalMail -and $m -eq $globalMail -and $m -notmatch 'noreply') {
            Write-Host "[$name] unpushed commits use your personal e-mail. Set: git -C `"$repo`" config user.email <id>+<login>@users.noreply.github.com" -ForegroundColor Red
            $found++
        }
    }
}
if ($found) { Write-Host "$found problem(s) found. Nothing was pushed." -ForegroundColor Red; exit 1 }
Write-Host "No secrets or personal data found." -ForegroundColor Green
