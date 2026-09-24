# Puts github/main on the live dashboard (:3000, and the phone app through Tailscale). Run it after a PR merges:
#   powershell -File scripts\deploy_live.ps1
# The live folder is deploy-only: sessions work in their own worktrees (scripts\new_worktree.ps1), so the only change
# it may hold is app/queueSnapshot.ts, which the 15-minute snapshot task rewrites. Anything else means a session is
# editing it directly, and deploying would overwrite that work, so the script stops and names the files.
$ErrorActionPreference = 'Stop'
$live = 'C:\Users\YOU\Documents\Codex\LeviOps-V11-6026-v10'
$snapshot = 'app/queueSnapshot.ts'
Set-Location $live

$dirty = @(git status --porcelain | Where-Object { $_ -and $_.Substring(3) -ne $snapshot })
if ($dirty.Count) { throw "Live folder has edits besides $snapshot; move them to a worktree first:`n$($dirty -join "`n")" }

git fetch github --quiet
if ($LASTEXITCODE) { throw 'git fetch github failed' }
$before = git rev-parse HEAD
$lockChanged = [bool](git diff --name-only $before github/main -- package-lock.json)
# -f only discards the snapshot (checked above); the refresh below regenerates it against main's types.
git checkout -f --detach github/main
if ($LASTEXITCODE) { throw 'git checkout github/main failed' }
$sha = git rev-parse --short HEAD

if ($lockChanged) { npm ci; if ($LASTEXITCODE) { throw 'npm ci failed' } }

# Windows PowerShell turns redirected native stderr into errors, which 'Stop' would make fatal mid-deploy.
$ErrorActionPreference = 'Continue'
$refresh = & "$live\scripts\refresh_snapshot.cmd" 2>&1 | Out-String
$ErrorActionPreference = 'Stop'
if ($refresh -notmatch 'LIVE_FEED_PUSH_OK') { Write-Warning "Snapshot refresh did not report LIVE_FEED_PUSH_OK; building with main's copy.`n$refresh" }

npm run build
if ($LASTEXITCODE) { throw "npm run build failed on $sha; :3000 is still serving the previous build" }

# The LeviAgent web-services supervisor respawns vinext on :3000 about 2 s after it exits.
$old = (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue).OwningProcess
if ($old) { Stop-Process -Id $old -Force -Confirm:$false }
Start-Sleep 3
for ($i = 0; $i -lt 30; $i++) {
  try { if ((Invoke-WebRequest http://127.0.0.1:3000/ -UseBasicParsing -TimeoutSec 5).StatusCode -eq 200) { Write-Output "DEPLOY_OK $sha"; exit 0 } } catch {}
  Start-Sleep 2
}
throw ":3000 did not come back with a 200 after deploying $sha"
