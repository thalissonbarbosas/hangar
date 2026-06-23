# Feature: Checkout Task Branch in Project Root

## Trunk Metadata
- **Type:** feat
- **Flag:** none
- **Complexity:** med
- **Issue:** — (filled by `/issues`)
- **Branch (post-/issues):** `feat/<issue-number>-checkout-task-branch`

## Problem

When an AIWF card has a task-scoped worktree on a dedicated branch, developers
often want to run the project's dev server (or test suite) on that branch from
the project root directory — not from the isolated worktree path. Currently
there is no in-app way to do this; the developer has to manually find the task
branch name, remove the worktree (since git forbids checking out a branch that
is already checked out in a worktree), and run `git checkout` themselves.

## Solution

Add a **Checkout** button to the card data sidebar (`CardDataModal`). Clicking
it removes the worktree (preserving the branch), checks out the task branch in
the project root, and updates the button to reflect the active state. A
**Back to main** button appears so the developer can restore the project root
to `main` when done testing.

A new `GET /api/aiwf/projects/:id/branch` endpoint exposes the project root's
current HEAD branch so the UI can reflect actual state across page refreshes.

## Technical Design

### API Changes

**`GET /api/aiwf/projects/:id/branch`**
Returns the current HEAD branch of the project's `repoPath`.
```json
{ "branch": "hangar/fix-login-abc12345" }
```
Errors:
- `404` — project not found
- `500` — not a git repo or command failed

**`POST /api/aiwf/projects/:id/cards/:key/checkout`**
Checks out the card's `taskBranch` in the project root.
Steps on the server:
1. Resolve project → get `repoPath` and card's `taskBranch`
2. **Active-session guard**: scan in-memory runs for any run whose `cwd` is inside
   `repoPath` and whose `state` is in `ACTIVE_STATES` (`queued/starting/running/
   awaiting_input`). If any exist, return `409` with
   `{ error: "active_sessions", message: "N session(s) are still running in this project. Stop them before switching branches.", runIds: string[] }`.
   The UI surfaces this as a blocking warning listing the active session titles.
3. If an active worktree exists for this card (`worktreeState` in aiwf.ts), remove
   it (same logic as `DELETE /worktrees/:key`) to free the branch for checkout
4. Run `git checkout <taskBranch>` in `repoPath`
5. Return `{ ok: true, branch: taskBranch, previousBranch: string }`

Errors:
- `404` — project or card not found
- `400` — card has no `taskBranch`
- `409 active_sessions` — one or more runs are active in this project (see step 2)
- `409 dirty_tree` — git checkout failed due to uncommitted changes; include raw git stderr
- `500` — unexpected error

**`POST /api/aiwf/projects/:id/checkout`**
Generic branch checkout on the project root. Used by "Back to main".
Body: `{ branch: string }`
Returns `{ ok: true, branch: string }`
Applies the same active-session guard (step 2 above) before running `git checkout`.
Errors: `404`, `400 (missing branch)`, `409 active_sessions`, `409 dirty_tree`, `500`

### Data Model
No schema changes. The server reads `taskBranch` and `worktreeState` already
tracked in the in-memory aiwf store (see `aiwf.ts`).

### Architecture

**Server (`server/src/index.ts`):**
- 3 new routes (≈50 lines): `GET branch`, `POST cards/:key/checkout`,
  `POST checkout`
- Branch checkout helper: `exec("git", ["-C", repoRoot, "checkout", branch])`
- Reuse existing `removeWorktree` from `worktree.ts`
- Detect `previousBranch` with `git rev-parse --abbrev-ref HEAD` before
  checkout

**Web:**
- `web/src/api.ts` — 3 typed wrappers (≈15 lines)
- `web/src/components/AiWorkflow.tsx` / `CardDataModal` — checkout button,
  back-to-main button, branch status indicator (≈60 lines)
- `web/src/styles.css` — button variant styles if needed (≈10 lines)

**No new files needed.**

## Security Considerations

The checkout endpoint runs a `git checkout` command on the server host as the
server process user. The `branch` value is validated to match the card's stored
`taskBranch` (for the card-scoped endpoint) or validated against a strict
pattern (`^[a-zA-Z0-9/_.-]{1,100}$`) for the generic checkout endpoint before
being passed to the shell. No shell interpolation — the branch is passed as a
positional argument to `exec`. No new auth surface beyond existing AIWF routes.

## Feature Flag
None — ships user-ready on merge.

## Verification Criteria

### Integration Tests
- [ ] `POST /checkout` with valid task branch → git HEAD changes; returns `{ ok: true, branch }`
- [ ] `POST /checkout` on a card whose worktree is active → worktree removed first, then checkout succeeds
- [ ] `POST /checkout` with dirty project root (uncommitted changes) → `409 dirty_tree` with git stderr
- [ ] `POST /checkout` with invalid branch name (path traversal `../../etc`) → `400`
- [ ] `GET /branch` → returns current HEAD branch string
- [ ] `POST /checkout` with `{ branch: "main" }` → project root returns to main
- [ ] `POST /checkout` while a run is in `running` state for this project → `409 active_sessions` with `runIds`
- [ ] `POST /checkout` while only a `done` run exists → guard passes, checkout proceeds

### E2E Tests
- [ ] Open card data sidebar for a card with `taskBranch` → "Checkout" button visible
- [ ] Click Checkout → button updates to "On this branch"; "Back to main" appears
- [ ] Click "Back to main" → button reverts; project root back on main
- [ ] Refresh page with project root on task branch → UI reflects checked-out state via `GET /branch`
- [ ] Checkout while worktree exists → worktree entry disappears from WorktreeManager; branch still intact
- [ ] Click Checkout while a session is actively running → blocking warning appears listing the active session(s); checkout does not proceed

## Out of Scope
- Checking out branches from Jira board cards (AIWF cards only)
- Stashing / restoring uncommitted changes automatically (user must handle dirty tree themselves)
- Multiple `repoPaths` — only the first / primary `repoPath` of the project is used
