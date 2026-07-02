# Feature: Clear all sessions for a task from the run panel

## Problem

When an operator works a ticket, a single task accumulates several sessions over time — the
original agent run plus every resume and hand-off, all sharing the same `ticketKey`. The session
side panel (`RunPanel`) shows one session's output with Resume / Hand off / Stop / Terminal
controls, but there is no way to wipe the task's sessions from inside the panel. To clean up, the
operator has to leave the panel, open the Sessions overlay, and delete each run individually.

There should be a one-click "Clear" button in the run panel that removes **all** sessions tied to
the current task at once.

## Solution

Add a danger-styled **Clear** button to the `RunPanel` header action row (alongside Resume, Hand
off, Stop). Clicking it deletes every run that shares the open run's `ticketKey` — stopping any
that are still active — then closes the panel. The cleared runs also disappear from the Sessions
list, since both views read the same server-side run store.

Grouping is by `ticketKey` (hand-offs and resumes preserve the parent's `ticketKey`, so the whole
chain is captured). For an ad-hoc run with no `ticketKey`, the button clears just that one run.

No new backend work is needed: the existing `DELETE /api/runs?scope=all` endpoint already accepts a
`{ ids }` body to restrict the operation to a specific set, and `clearRuns("all", ids)` stops active
runs, cleans up their worktrees, and deletes their records.

## Technical Design

### API Changes

None. Reuses `api.clearRuns("all", ids)` → `DELETE /api/runs?scope=all` with body `{ ids }`.

### Data Model

No changes.

### Architecture

- **`web/src/components/RunPanel.tsx`** — add an optional `onClearTask?: () => void` prop and render
  a `btn-ghost danger sm` "Clear" button (Trash2 icon) in the `run-head-actions` row, before Close.
  Title: "Delete all sessions for this task".
- **`web/src/App.tsx`** — add `clearTaskSessions(runId)`:
  - Look up the run in `runs`.
  - `ids` = all runs sharing that run's `ticketKey` (non-empty), else just `[runId]`.
  - Call `api.clearRuns("all", ids)`, then `setActiveRun(null)` and `refreshRuns()`.
  - Wire `onClearTask={() => clearTaskSessions(activeRun.runId)}` on `<RunPanel>`.

Consistent with the existing Sessions-view clear/delete controls, no confirmation dialog is shown.

## Security Considerations

No new endpoints or inputs. `clearRuns` already validates scope and operates only on in-memory run
records the operator owns. See `docs/THREAT_MODEL.md`.

## Feature Flag

None — slice is user-ready on merge.

## Verification Criteria

### Manual / Integration

- [ ] Open a task with multiple sessions (run → hand off/resume). Click **Clear** → all sessions for
      that `ticketKey` are removed, the panel closes, and the Sessions list no longer shows them.
- [ ] An active session for the task is stopped before removal (no orphaned worktree).
- [ ] Ad-hoc run (no `ticketKey`): **Clear** removes only that one run.
- [ ] Sessions belonging to other tasks are untouched.

### Static

- [ ] `npm run typecheck` passes.
- [ ] `npm run lint` passes.
- [ ] `npm --prefix web run build` succeeds.

## Out of Scope

- Backend changes to `clearRuns` (already supports id-scoped clears).
- A confirmation dialog (matches existing no-confirm clear/delete UX).
- Bulk-clear controls in the AI Workflow board or Workflows bar.

## Trunk Metadata

- **Type:** feat
- **Flag:** `none`
- **Complexity:** low
- **Issue:** — (filled by `/issues`)
- **Branch (post-/issues):** `feat/<issue-number>-clear-task-sessions`
