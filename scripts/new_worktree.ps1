# Gives one Claude session its own LeviOps checkout, so parallel sessions stop committing each other's edits.
#   powershell -File scripts\new_worktree.ps1 -Name weather-rain
# Creates C:\Users\YOU\Documents\Codex\LeviOps-worktrees\<Name> on a new branch <Name> cut from github/main,
# with node_modules junctioned to the live folder's (no 700 MB install) and .env.local copied (it is gitignored).
# Work, build and open the PR from there; the live folder only ever receives main, via scripts\deploy_live.ps1.
param([Parameter(Mandatory = $true)][ValidatePattern('^[a-z0-9][a-z0-9-]*$')][string]$Name)
$ErrorActionPreference = 'Stop'

$live = 'C:\Users\YOU\Documents\Codex\LeviOps-V11-6026-v10'
$root = 'C:\Users\YOU\Documents\Codex\LeviOps-worktrees'
$dir = Join-Path $root $Name
if (Test-Path $dir) { throw "$dir already exists; pick another name or cd into it." }

git -C $live fetch github --quiet
if ($LASTEXITCODE) { throw 'git fetch github failed' }
New-Item -ItemType Directory -Force $root | Out-Null
git -C $live worktree add --no-track -b $Name $dir github/main
if ($LASTEXITCODE) { throw "git worktree add failed (does branch '$Name' already exist?)" }

New-Item -ItemType Junction -Path (Join-Path $dir 'node_modules') -Target (Join-Path $live 'node_modules') | Out-Null
$envFile = Join-Path $live '.env.local'
if (Test-Path $envFile) { Copy-Item $envFile (Join-Path $dir '.env.local') }

Write-Output "WORKTREE_READY $dir (branch $Name from github/main)"
