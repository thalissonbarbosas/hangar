# Feature: Faster session startup (HAN-26)

## Problem

Operators notice that launching a session in Hangar takes longer to produce its first
output than running `claude` directly in a terminal. Everything the terminal does, Hangar
also does — but Hangar adds work on the **critical path before the SDK spawns the `claude`
subprocess**, delaying the first streamed event.

Investigation (see file/line references below) found the startup delta is dominated by
git worktree isolation, which a bare terminal skips entirely. Within that, two costs are
avoidable without changing any behavior:

1. **Serial worktree creation** — `drive()` in `server/src/sessions.ts` (lines ~874–894)
   awaits the primary repo's `git worktree add`, then creates each additional repo's
   worktree **one at a time** in an `await` loop. A board with N repos pays N sequential
   checkouts back-to-back, even though the repos are independent.
2. **SDK dynamic import on the first run** — `streamTurn()` (`sessions.ts:774`) does
   `await import("@anthropic-ai/claude-agent-sdk")`. Node caches the module after the first
   import, so only the **first run after each server boot** pays the import cost
   (~50–200ms) — but that first run is exactly when the "terminal feels faster" impression
   forms.

Neither change alters what a session does; both only remove idle waiting on the startup
path.

## Solution

Two behavior-preserving performance changes:

1. **Create all worktrees concurrently.** Kick off the primary and every additional-repo
   `createWorktree` call together with `Promise.all`, then assemble the results in their
   original order. Wall-clock for the worktree phase drops from *sum of all checkouts* to
   *slowest single checkout*. `Promise.all` preserves array order, so `run.cwd`,
   `run.branch`, `run.worktrees`, the `additionalDirectories` mapping, and the emitted
   `worktree` events are all unchanged in content and order.

2. **Pre-warm the SDK module at server startup.** Fire a non-blocking
   `import("@anthropic-ai/claude-agent-sdk")` during boot in `server/src/index.ts` so the
   module is resolved and cached before the first run. `streamTurn()` keeps its existing
   `await import(...)`, which now resolves instantly from cache on the first run too.

## Technical Design

### API Changes

None. No routes, request/response shapes, or status codes change.

### Data Model

None. No config fields, schema, or persisted-run shape changes.

### Architecture

Both changes are internal to the server run path (`sessions.ts`) and startup (`index.ts`).
No change to the SSE stream, the web client, `worktree.ts`'s public functions, or config.

**Change 1 — parallel worktree creation** (`server/src/sessions.ts`, in `drive()`):

Replace the serial primary-then-loop pattern:

```ts
const primary = await createWorktree(run.cwd, label, run.id);
// ...assign run.cwd / run.branch / emit...
const mapped: string[] = [];
for (const d of additionalDirectories) {
  const wt = await createWorktree(d, label, run.id);
  // ...push / emit / fallback...
}
```

with a single concurrent batch that preserves order:

```ts
const [primary, ...extra] = await Promise.all([
  createWorktree(run.cwd, label, run.id),
  ...additionalDirectories.map((d) => createWorktree(d, label, run.id)),
]);
// primary → run.cwd / run.branch / run.worktrees[0] / emit "worktree" (unchanged logic)
// extra[i] ↔ additionalDirectories[i]: push worktree + emit on success, else keep original dir
```

Emits are still produced in primary-then-additional order after the batch resolves, so the
run event log is byte-for-byte equivalent to today's. `createWorktree` already returns
`null` (never throws) on non-git dirs and git errors, so no `.filter(Boolean)`/rejection
handling is needed — the existing per-result null checks are preserved.

**Change 2 — pre-warm the SDK** (`server/src/index.ts`, in the boot section that already
calls `loadConfig()` / `loadPersistedRuns()`):

```ts
// Pre-warm the ESM-only Agent SDK so the first run doesn't pay the import cost on its
// critical path. Non-blocking; streamTurn() still awaits import() and hits the module cache.
void import("@anthropic-ai/claude-agent-sdk").catch(() => {});
```

Guarded so a resolution failure can't crash boot (the real `await import` in `streamTurn`
still surfaces any genuine error at run time).

## Security Considerations

None. No new inputs, endpoints, or data exposure. Worktree creation still runs the same
`git` commands with the same arguments (via `execFile`, no shell interpolation) — only their
scheduling changes. Reference `docs/THREAT_MODEL.md`; no threat surface is affected.

## Feature Flag

None — both changes are behavior-preserving and user-ready on merge.

## Verification Criteria

### Unit Tests (`server/src/__tests__/sessions.test.ts`, `worktree.test.ts`)

- [ ] Existing worktree tests still pass unchanged (createWorktree contract untouched).
- [ ] Multi-repo run: `createWorktree` is called once for the primary and once per
      additional directory (assert call count and args) — parity with current behavior.
- [ ] Order preserved: `run.cwd`/`run.branch` come from the primary worktree, and
      `additionalDirectories` map to their worktree paths in the same index order.
- [ ] A non-git additional dir (createWorktree → `null`) falls back to the original path,
      and a non-git primary runs in place — same as today.
- [ ] `worktree` events are emitted in primary-then-additional order.

### Integration / Manual

- [ ] `npm run typecheck` exits 0; `npm run lint -- --max-warnings=2` exits 0;
      `npm --prefix server test` passes; `npm run format:check` passes.
- [ ] `HANGAR_DEMO=1 npm run dev` boots without errors and the pre-warm import logs no
      failure.
- [ ] Manual timing on a multi-repo board: measure elapsed time from `POST /api/runs`
      to the first `worktree`/`system` SSE event before vs. after. Expect the worktree
      phase to shrink toward a single checkout's duration; first-run import stall gone.
- [ ] Run `/smoke` (demo-mode critical-path check) before merge, per `CLAUDE.md`.

## Out of Scope

- **`resolveCardWorktree` blocking the `POST /api/runs` response** (`routes/runs.ts:92`,
  delivery skills on Jira tickets). Moving it off the response path would change the
  request/response timing contract and how the client learns the task worktree — deferred
  as a separate, riskier change.
- Deferring/lazy worktree creation, streaming a "preparing" UI state, or reusing a warm
  `claude` subprocess pool — all considered and explicitly excluded (safe-perf-only scope).
- Reducing the cost of an individual `git worktree add` checkout (inherent to isolation).

## Trunk Metadata
- **Type:** perf
- **Flag:** `none`
- **Complexity:** low
- **Issue:** — (filled by `/issues`)
- **Branch (post-/issues):** `perf/<issue-number>-session-startup-speed`
