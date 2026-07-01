# Feature: Restart an errored session with a fresh run

## Problem

When an agent/skill session ends in the **error** state, the operator's only recovery
option in the session panel is **Resume** — and Resume only appears when the run recorded a
Claude `sessionId`. Many errors happen *before* a session id exists (worktree creation failed,
the working dir was missing, the SDK failed to initialize), so Resume is unavailable and the
operator is stuck: they must go back to the board and re-assign the agent by hand. Even when a
session id does exist, resuming picks the broken session back up rather than starting clean.

The operator wants a one-click way to **run a fresh session** — same agent/skill, same ticket
and context, brand-new Claude session and worktree — directly from the session panel of an
errored run. The button should be named **Restart**.

## Solution

Add a **Restart** action to the `RunPanel` header, shown only when the run is in the `error`
state. Clicking it starts a brand-new run that replays the errored run's original launch
options (kind, agent/skill name, note, ticket/context) through the normal `startRun` path — so
it gets a fresh worktree and a fresh Claude session — then swaps the panel over to the new run.

To replay faithfully regardless of where the original run failed, `startRun` records the exact
`StartOpts` it was launched with on the `Run` (persisted with the record). Restart re-runs those
stored options.

## Technical Design

### API Changes

New endpoint:

- `POST /api/runs/:id/restart` — start a fresh run from an errored run's original options.
  - `404 { error }` — no run with that id.
  - `409 { error }` — the run is not in the `error` state (only errored runs are restartable).
  - `409 { error }` — the run has no stored launch options (e.g. a legacy run persisted before
    this feature; it cannot be replayed).
  - `200 { runId }` — id of the newly started run (same shape as `POST /api/runs`).

Client wrapper in `web/src/api.ts`:

```ts
restartRun: (runId: string) =>
  sendJson<StartRunResult>("POST", `/api/runs/${runId}/restart`, {}),
```

### Data Model

No config or schema changes. One new field on the in-memory/persisted run:

- `Run.startOpts?: StartOpts` — the original launch options, captured in `startRun`. `StartOpts`
  is plain serializable data, so it flows through `RunRecord` (which only omits the runtime
  handles) and survives server restarts. Runs persisted before this change simply lack the field
  and are reported as non-restartable (`409`).

### Architecture

- **`server/src/sessions.ts`**
  - Add `startOpts?: StartOpts` to the `Run` interface.
  - In `startRun`, set `run.startOpts = opts` when constructing the run.
  - Add `export function restartRun(run: Run): Run | undefined` — returns
    `startRun(run.startOpts)` when `run.startOpts` is present, else `undefined`.
- **`server/src/routes/runs.ts`** — add the `POST /api/runs/:id/restart` route (guards above),
  reusing the existing `runCreateLimiter` rate limiter since it creates a run.
- **`web/src/api.ts`** — add the `restartRun` wrapper.
- **`web/src/components/RunPanel.tsx`** — add a **Restart** button (icon `RefreshCw`) in the
  header, rendered only when `state === "error"`. It calls a new `onRestart` prop.
- **`web/src/App.tsx`** — add a `restart(runId)` handler that calls `api.restartRun`, points
  `activeRun` at the returned run id, and refreshes the run list; pass it as `onRestart` to
  `RunPanel`.

Reference `CLAUDE.md` → "Run model" and "Adding an API route" (define in route file + typed
wrapper in `api.ts` + keep `web/src/types.ts` in sync).

## Security Considerations

No new auth surface — the endpoint mirrors the existing `POST /api/runs` trust model (local,
operator-driven) and reuses `runCreateLimiter`. It takes no free-text body; it only replays
options already validated when the original run was created, so there's no new injection or
path-traversal surface. Restart is refused unless the run is in the `error` state, preventing it
from spawning duplicates of a live/queued run.

## Feature Flag

None — the slice is user-ready on merge.

## Verification Criteria

### Unit / Integration Tests (server, `server/src/__tests__`)
- [ ] `restartRun` on a run with `startOpts` → returns a new `Run` with a different id, `state`
      `starting`/`queued`, and matching `kind`/`agentName`.
- [ ] `restartRun` on a run without `startOpts` → returns `undefined`.
- [ ] `POST /api/runs/:id/restart` on an errored run → `200 { runId }`, new id ≠ original.
- [ ] `POST /api/runs/:id/restart` on a `done`/`running` run → `409`.
- [ ] `POST /api/runs/:missing/restart` → `404`.

### Manual (demo mode: `HANGAR_DEMO=1 npm run dev`)
- [ ] Open an errored session → header shows **Restart** (and no Resume when there's no
      session id); other states show no Restart button.
- [ ] Click **Restart** → panel switches to a new run that begins from scratch (fresh
      "Starting…", new worktree/branch), original errored run still present in the sessions list.

### Gates (from `CLAUDE.md`)
- [ ] `npm run typecheck`, `npm run lint -- --max-warnings=2`, `npm --prefix server test`,
      `npm run format:check` all pass. Run `/smoke` before merging (server change).

## Out of Scope

- Restarting non-error states (done/stopped/running) — Resume/handoff already cover those.
- Restarting workflow runs (the multi-step engine) — this covers single agent/skill/chat runs.
- Auto-restart / retry-on-error policies — this is a manual, operator-initiated action.
- Cleaning up the failed run's worktree — existing worktree-cleanup tooling handles that.
