# LeviOps: one worktree per session

Several Claude sessions work on this repo at once. When they all edited the live folder, commits swept up each
other's half-done work (one PR shipped another session's layout change under a weather title). So:

- **Never edit in `C:\Users\YOU\Documents\Codex\LeviOps-V11-6026-v10`.** That folder is the live dashboard (:3000
  and the phone app). It is deploy-only and sits on `github/main`; its only expected change is
  `app/queueSnapshot.ts`, which the 15-minute snapshot task rewrites.
- **Start every task in your own worktree:**
  `powershell -File C:\Users\YOU\Documents\Codex\LeviOps-V11-6026-v10\scripts\new_worktree.ps1 -Name <short-task-name>`
  It creates `C:\Users\YOU\Documents\Codex\LeviOps-worktrees\<name>` on branch `<name>` from `github/main`, with
  `node_modules` junctioned to the live folder's and `.env.local` copied. Build and preview there (use a port other
  than 3000 for a dev server).
- **Ship from the worktree:** commit, `git push -u github <name>`, `gh pr create`. `auto-merge.yml` squash-merges
  once the build passes.
- **Go live after the merge:** `powershell -File C:\Users\YOU\Documents\Codex\LeviOps-V11-6026-v10\scripts\deploy_live.ps1`
  moves the live folder to `github/main`, refreshes the snapshot, builds, restarts :3000 and prints `DEPLOY_OK <sha>`.
  It refuses if the live folder holds any other edits.
- **Clean up** once merged and deployed:
  `powershell -File C:\Users\YOU\Documents\Codex\LeviOps-V11-6026-v10\scripts\remove_worktree.ps1 -Name <name>`.
  Don't delete a worktree folder by hand: its `node_modules` is a junction to the live folder's real modules, and a
  recursive delete through it wipes them.

`scripts/refresh_snapshot.py` writes the 'Site Snapshot' sheet and pushes the live feed only when it runs from the live
folder. Run from a worktree, it regenerates that worktree's `app/queueSnapshot.ts` for previews and prints
`SITE_SNAPSHOT_SKIPPED_NOT_LIVE_FOLDER` / `LIVE_FEED_PUSH_SKIPPED_NOT_LIVE_FOLDER`. To push a data change live, merge
it and run `deploy_live.ps1` (or the script from the live folder).

Keep `app/queueSnapshot.ts` out of commits; it is regenerated. Type changes go in `scripts/refresh_snapshot.py`'s
template as well.
