# Slice 002: Apply update

## Trunk Metadata
- **Type:** feat
- **Flag:** `none` — user-ready on merge
- **Depends on:** 001 (the `update.ts` module and Updates section must exist)
- **Complexity:** med
- **Issue:** — (filled by `/issues`)
- **Branch (post-/issues):** `feat/<issue-number>-apply-update`

## Problem

Slice 001 shows that an update is available but can't apply it. This slice adds the action: a
safe, fast-forward `git pull` in the repo root, triggered from the Updates section, that
preserves every session record and tells the operator what changed.

## Solution

Add `applyUpdate()` to `server/src/update.ts` and `POST /api/update/pull`. The Updates section
gets an **Update now** button with a pre-pull confirm that surfaces how many sessions are active.
After a successful pull, `tsx watch` restarts the server on the changed files (no self-restart
code); the UI reports the result and warns if dependencies changed.

## Technical Design

### API Changes

`POST /api/update/pull` → `200 UpdateResult` on success, `409` when refused (unsafe state):

```ts
interface UpdateResult {
  ok: boolean;
  fromCommit: string;    // short SHA before pull
  toCommit: string;      // short SHA after pull
  changedFiles: number;  // files changed by the pull
  depsChanged: boolean;  // any *package-lock.json changed → operator should reinstall
  restartExpected: boolean; // true when server files changed (tsx watch will restart)
}
```

Refusal (`409 { error }`) when: not a git work tree, `dirty`, no upstream, or `ahead > 0` with
`behind === 0` (nothing to pull) / diverged (can't fast-forward). Demo mode → `403` with a
clear message. The message is shown verbatim in the UI.

### Architecture

- **`server/src/update.ts`**: add `applyUpdate(): Promise<UpdateResult>`.
  - Re-check state via the same helpers as `getUpdateStatus` (don't trust the client): resolve
    repo root, refuse on non-git / dirty / no-upstream / non-fast-forwardable, and in demo mode.
  - Capture `fromCommit` (`git rev-parse --short HEAD`), run `git pull --ff-only` (execFile, arg
    array, `cwd: repoRoot()`), capture `toCommit`.
  - `git diff --name-only <fromCommit> <toCommit>` → `changedFiles` = line count; `depsChanged`
    = any path ending in `package-lock.json`; `restartExpected` = any path under `server/`.
  - On `git pull` failure (conflict/non-ff) → throw a typed error the route maps to `409`.
- **`routes/update.ts`**: add the `POST /api/update/pull` handler; map refusals to 409 / demo to
  403, success to 200.
- **`web/src/api.ts`**: `applyUpdate: () => sendJson<UpdateResult>("POST", "/api/update/pull", {})`.
- **`web/src/types.ts`**: add `UpdateResult`.
- **`web/src/components/Settings.tsx`** — extend `UpdateSection`:
  - **Update now** button, enabled only when `git && behind > 0 && !dirty && ahead === 0` and not
    demo (mirror the server guards so the button is disabled with a reason otherwise).
  - On click, a confirm step: fetch `api.runs()` (or reuse a passed-in count) and show
    "N session(s) are active. Updating restarts the server — active runs will be marked stopped
    (their transcripts are kept). Continue?" Proceed only on confirm.
  - On success: show `fromCommit → toCommit`, `changedFiles`, a "Server is restarting…" note when
    `restartExpected`, and a prominent "Dependencies changed — run `npm run install:all` and
    restart" warning when `depsChanged`. Re-fetch status after a short delay.
  - On 409/403: show the server's error message in the existing `bad` style.

### Data Model

None. Sessions are untouched: `.hangar/` is gitignored so `git pull` cannot modify run records;
on the `tsx watch` restart, `loadPersistedRuns()` restores all records and marks previously
`running`/`starting` runs as `stopped` with an explanatory event (existing behavior — this slice
relies on it, adds nothing).

## Security Considerations

- Same `execFile`/arg-array discipline as slice 001 — no shell, no injection. No user input in
  git args (`{}` body is ignored).
- Fast-forward-only + refuse-on-dirty means the pull can never overwrite or discard local
  changes; the destructive `reset --hard` path is deliberately not implemented.
- Mutating endpoint, but localhost-only behind existing CORS + rate limiting; the action is
  idempotent-ish (a second pull with nothing to pull refuses cleanly).

## Feature Flag

None — slice is user-ready on merge. The action is gated by an explicit click and server-side
safety checks.

## Verification Criteria

### Unit Tests (`server/src/__tests__/update.test.ts`)
- [ ] Temp git repo behind a remote → `applyUpdate()` fast-forwards; `toCommit` = remote head,
      `changedFiles > 0`.
- [ ] `depsChanged === true` when the pulled diff touches a `package-lock.json`; `false` otherwise.
- [ ] `restartExpected === true` when a `server/` file changed.
- [ ] Dirty tree → refuses (throws typed error), work tree untouched.
- [ ] No upstream / diverged (non-ff) → refuses, no partial state.
- [ ] Demo mode → refuses without spawning git.

### Integration Tests (`server/src/__tests__/index.update.test.ts`)
- [ ] `POST /api/update/pull` in a non-git/dirty fixture → 409 with `error`.
- [ ] Demo mode → 403.
- [ ] Happy path against a temp repo behind its remote → 200 `UpdateResult`.

### Manual
- [ ] On a branch behind its upstream: Settings → Updates → **Update now** → confirm → server
      restarts via `tsx watch`; prior sessions still listed (active ones now `stopped`).
- [ ] Pull that changes a lockfile shows the reinstall warning.

## Out of Scope
- Auto-running `npm install` (deliberately: long-running, can fail mid-restart — we detect and
  prompt instead).
- `git reset --hard` / auto-stash recovery paths.
- Managed runner / production build (see README run-model note).
