# Feature: Update settings section

## Problem

Hangar runs from a git clone that the operator started with `npm run dev`. There is no in-app
way to pull the latest code — the operator has to drop to a terminal, remember the repo path,
`git pull`, and hope nothing was lost. Two concerns make a manual pull risky:

1. **Sessions must survive the update.** In-progress and stopped session records must not be
   lost. They live under `.hangar/` (gitignored JSON via `store.ts`), so a `git pull` never
   touches them, and on restart `loadPersistedRuns()` restores every record — marking any that
   were `running`/`starting` as `stopped` with their transcript intact. The update flow must
   preserve this guarantee and make it visible, not silently kill live runs.
2. **Applying an update is fiddly.** A dirty working tree, a diverged branch, or a
   dependency-lockfile change each need handling; a blind `git pull` can fail or leave a broken
   install.

This feature adds an **Updates** section to Settings that shows whether an update is available
and applies it safely — a fast-forward `git pull` in the repo root where the app is running.

## Run model (operator question answered)

The operator asked whether Hangar needs a more stable way to run than `npm run dev`. Decision:
**keep `npm run dev`.** `tsx watch` already auto-restarts the server when server files change,
and Vite HMR reloads the web — so a `git pull` propagates into the running app with no extra
process manager, no build step, and no new dependency. This is also what makes the update flow
work with zero self-restart machinery. A managed runner (pm2 / production build + supervisor)
is explicitly **out of scope**; if stability ever demands it, record it as a separate ADR.

## Slices

| # | Slice | Type | Flag | Depends on | Complexity | Issue | Status |
|---|-------|------|------|------------|------------|-------|--------|
| 001 | [update-status](001_update-status.md) | feat | `none` | — | med | — | Not started |
| 002 | [apply-update](002_apply-update.md) | feat | `none` | 001 | med | — | Not started |

- **001 — Update status:** read-only. Adds the `server/src/update.ts` module (git status +
  `git fetch`), `GET /api/update/status`, and the new **Updates** Settings section showing
  version, branch, up-to-date / N-commits-behind, and a dirty-tree warning, with a "Check for
  updates" refresh. Ships user-ready: the operator can see whether an update exists.
- **002 — Apply update:** the action. Adds `applyUpdate()` (`git pull --ff-only`, lockfile-change
  detection), `POST /api/update/pull`, and an **Update now** button with a pre-pull confirm that
  surfaces active-run count. Depends on 001's module + section existing.

Both slices leave `main` deployable and are user-ready on merge — no feature flag. Slice 002's
only mutating action is gated behind an explicit operator click plus server-side safety checks
(fast-forward only, refuse on dirty/diverged tree), so it needs no flag.

## Rollout

No flags to flip. Slice 001 merges first (endpoint + read-only UI), then 002 adds the action.
After both merge, verify end-to-end by running `npm run dev`, opening Settings → Updates,
confirming the status renders, and (on a branch that is behind its upstream) applying an update
and watching `tsx watch` restart the server with all prior session records restored.
