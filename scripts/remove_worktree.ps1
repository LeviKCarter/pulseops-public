# Removes a session worktree made by new_worktree.ps1, once its PR has merged:
#   powershell -File scripts\remove_worktree.ps1 -Name weather-rain
# Every junction and symlink under the worktree is unlinked first (node_modules, the public preview stage's, any other):
# a recursive delete that followed one, git worktree remove's included, would empty its target, e.g. the live modules.
param([Parameter(Mandatory = $true)][ValidatePattern('^[a-z0-9][a-z0-9-]*$')][string]$Name, [switch]$KeepBranch)
$ErrorActionPreference = 'Stop'
$live = 'C:\Users\YOU\Documents\Codex\LeviOps-V11-6026-v10'
$dir = Join-Path 'C:\Users\YOU\Documents\Codex\LeviOps-worktrees' $Name
if (-not (Test-Path $dir)) { throw "$dir does not exist" }

$changes = git -C $dir status --porcelain
if ($changes) { throw "$Name has uncommitted changes; commit or discard them first:`n$($changes -join "`n")" }

# Walks the tree without ever descending into a link, so the scan itself never reaches what a link points at.
function Find-Links([string]$root) {
  $links = @()
  $pending = [System.Collections.Generic.Stack[string]]::new()
  $pending.Push($root)
  while ($pending.Count) {
    foreach ($item in Get-ChildItem -LiteralPath $pending.Pop() -Force) {
      if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { $links += $item }
      elseif ($item.PSIsContainer) { $pending.Push($item.FullName) }
    }
  }
  return $links
}

# rmdir (never /s) and del remove only the link itself, not what it points at.
foreach ($link in Find-Links $dir) {
  if ($link.PSIsContainer) { cmd /c rmdir "$($link.FullName)" } else { cmd /c del /q "$($link.FullName)" }
  if (Test-Path -LiteralPath $link.FullName) { throw "Could not unlink $($link.FullName); remove it by hand (rmdir, not a recursive delete)." }
}
$left = @(Find-Links $dir)
if ($left) { throw "Links remain under ${dir}; not deleting anything:`n$($left.FullName -join "`n")" }

# --force lets it delete the ignored build output (dist, .vinext, public-preview-dist, ...); the status check above
# already refused on anything uncommitted.
git -C $live worktree remove --force $dir
if ($LASTEXITCODE) { throw 'git worktree remove failed' }
# Whatever it could not delete is build output with no links left in it (checked above).
if (Test-Path $dir) {
  if (@(Find-Links $dir)) { throw "Links appeared under $dir; not deleting it." }
  Remove-Item -LiteralPath $dir -Recurse -Force
}
if (-not $KeepBranch) { git -C $live branch -D $Name }
Write-Output "WORKTREE_REMOVED $Name"
