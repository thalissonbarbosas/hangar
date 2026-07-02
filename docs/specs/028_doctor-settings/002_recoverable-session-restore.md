# Feature: Recoverable session restore

## Trunk Metadata
- **Type:** feat
- **Flag:** `none` — user-ready on merge
- **Complexity:** med
- **Issue:** — (filled by `/issues`)
- **Branch (post-/issues):** `feat/<issue-number>-recoverable-session-restore`
- **Depends on:** 001 (extends the `DoctorReport` and the `DoctorSection` UI)

## Problem

This is the operator's headline pain: when the server restarts, all mid-flight runs are marked
`stopped` and feel lost, so each ticket gets re-assigned from scratch. In fact those runs keep a
Claude `sessionId`, `cwd`, and `runtimeDirs`, and `sendMessage()` can resume any run with a
`sessionId` — but that path is per-run and undiscoverable, and it fails silently when the run's
worktree directory no longer exists. The Doctor should list the sessions that **can** be brought
back and resume them in one click, and clearly flag the ones that **can't** (worktree gone) with
the reason.

## Solution

Extend the Doctor (from slice 001) with a **Recoverable sessions** block: the runs that ended in
`stopped`/`error` with a saved `sessionId`. Each is classed **recoverable** when its `cwd` still
exists on disk, or **unrecoverable** when the worktree is gone (shown greyed with the reason).
A **Resume** button on a recoverable row reattaches the Claude session (SDK `resume`) with a
short continuation nudge and switches the operator to the live session. A guard in the resume
path turns the previously-silent "worktree missing" failure into a clear error.

## Technical Design

### API Changes

Extend `GET /api/doctor` (slice 001) — add `recoverableSessions` to `DoctorReport`:

```ts
interface RecoverableSession {
  id: string;
  title: string;        // ticketKey || title || agentName
  ticketKey?: string;
  agentName: string;
  kind: RunKind;
  state: "stopped" | "error";
  cwd: string;
  cwdExists: boolean;   // false ⇒ unrecoverable (worktree pruned)
  endedAt?: number;
}
interface DoctorReport {
  checks: DoctorCheck[];
  recoverableSessions: RecoverableSession[];
  generatedAt: number;
}
```

New route in `server/src/routes/doctor.ts`:

- `POST /api/doctor/sessions/:id/recover` — resume a recoverable session.
  - `404 { error }` — no run with that id.
  - `409 { error: "not_recoverable", message }` — run is active, has no `sessionId`, or its
    `cwd` no longer exists (message states which).
  - `200 { ok: true, runId }` — resume started; the client subscribes to the run's SSE stream.
  - Reuses the existing `runCreateLimiter` (it starts a session turn).

Client wrappers in `web/src/api.ts`:

```ts
recoverSession: (id: string) =>
  sendJson<{ ok: true; runId: string }>("POST", `/api/doctor/sessions/${id}/recover`, {}),
```

(`doctor()` from slice 001 now also returns `recoverableSessions`.)

### Data Model

No config or persisted-schema changes. `recoverableSessions` is derived at request time from the
already-persisted runs; `RecoverableSession` is a new shared type (add to `server/src/types.ts`,
mirror in `web/src/types.ts`).

### Architecture

- **`server/src/sessions.ts`**
  - Add `export function recoverableRuns(): RecoverableSession[]` — maps runs where
    `state ∈ {stopped, error}` and `sessionId` is set, computing `cwdExists` via `existsSync`.
  - Add `export function recoverRun(run: Run): "started" | "not_recoverable"` — the recovery
    entry point: refuses when the run is active, has no `sessionId`, or `!existsSync(run.cwd)`;
    otherwise calls the existing resume path with a canned seed
    (`"Resume this session and continue where you left off."`) so no work is repeated. Factor the
    existing `resumeRun` seed handling so `sendMessage`'s resume branch and `recoverRun` share it.
  - Harden `resumeRun`: before streaming, if `!existsSync(run.cwd)` emit a clear `error` event and
    return instead of letting the SDK fail opaquely (closes the "silent failure" gap noted in the
    Problem, and also protects the existing per-run Resume).
- **`server/src/doctor.ts`** — `runDiagnostics()` now also calls `recoverableRuns()` and includes
  the list on the report.
- **`server/src/routes/doctor.ts`** — add the `POST /api/doctor/sessions/:id/recover` handler
  (guards above) calling `recoverRun`.
- **`server/src/types.ts`** / **`web/src/types.ts`** — add `RecoverableSession`; extend
  `DoctorReport`.
- **`web/src/api.ts`** — add `recoverSession`.
- **`web/src/components/Settings.tsx`** — in `DoctorSection`, render the **Recoverable sessions**
  block: recoverable rows with a **Resume** button (calls `api.recoverSession`, then invokes an
  `onOpenRun(runId)` callback threaded from `App.tsx` so the panel switches to the live run and
  re-fetches the report); unrecoverable rows greyed with the reason (`worktree removed`).
- **`web/src/App.tsx`** — pass an `onOpenRun` handler into `Settings` → `DoctorSection` that sets
  the active run id and opens the run panel (same mechanism the sessions list already uses).

### Architecture reference

`ARCHITECTURE.md` → "In-memory run state" documents exactly this loss: a restart drops live
handles while transcripts survive on disk. This slice operationalizes recovery from that state.
Follows `CLAUDE.md` → "Adding an API route" and the "Run model" resume semantics.

## Security Considerations

- No new free-text input on the recover endpoint — the seed is a fixed server-side string, so no
  prompt-injection surface beyond what the original run already carried.
- The endpoint only acts on an existing persisted run id; it cannot point a session at an
  arbitrary path (`cwd` comes from the stored run, and is existence-checked, not client-supplied).
- Refusing recovery when `cwd` is gone prevents resuming a session against a stale/rebuilt
  working directory. Same local-only trust model and `runCreateLimiter` as `POST /api/runs`.

## Feature Flag

None — the slice is user-ready on merge.

## Verification Criteria

### Unit / Integration Tests (server, `server/src/__tests__`)
- [ ] `recoverableRuns()`: a `stopped` run with a `sessionId` and existing `cwd` → present with
      `cwdExists: true`; same run with a missing `cwd` → present with `cwdExists: false`; a run
      with no `sessionId` or an active run → absent.
- [ ] `recoverRun` on a run with `sessionId` + existing `cwd` → `"started"` and the run leaves the
      terminal state; on a run with a missing `cwd` or no `sessionId` → `"not_recoverable"`.
- [ ] `GET /api/doctor` includes `recoverableSessions` with the fields above.
- [ ] `POST /api/doctor/sessions/:id/recover`: recoverable → `200 { runId }`; missing `cwd`/no
      `sessionId`/active → `409 not_recoverable`; unknown id → `404`.

### Manual (demo mode: `HANGAR_DEMO=1 npm run dev`)
- [ ] Seed a `stopped` demo run with a `sessionId` → Doctor lists it under **Recoverable
      sessions** with a **Resume** button; a stopped run whose `cwd` is missing shows greyed with
      "worktree removed".
- [ ] Click **Resume** → panel switches to the run, which re-enters `running` and continues.

### Gates (from `CLAUDE.md`)
- [ ] `npm run typecheck`, `npm run lint -- --max-warnings=2`, `npm --prefix server test`,
      `npm run format:check` all pass. Run `/smoke` before merging (server change).

## Out of Scope

- **Resume all** / bulk recovery — a per-session Resume ships the value; batch is a later add.
- Re-creating a missing worktree to recover an unrecoverable session — reported, not repaired.
- Recovering workflow (multi-step pipeline) runs — this covers single agent/skill/chat runs;
  the workflow engine has its own restart handling.
- Changing the restart-time `loadPersistedRuns()` behavior (it still marks runs `stopped`) — the
  Doctor recovers from that state rather than preventing it.
