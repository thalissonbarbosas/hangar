# Slice 001: Update status

## Trunk Metadata
- **Type:** feat
- **Flag:** `none` — user-ready on merge
- **Depends on:** —
- **Complexity:** med
- **Issue:** — (filled by `/issues`)
- **Branch (post-/issues):** `feat/<issue-number>-update-status`

## Problem

The operator has no in-app signal that a newer Hangar is available. They must leave the app,
find the repo, and run git by hand. This slice surfaces the state — current version/commit,
branch, whether the checkout is behind its upstream, and whether the tree is dirty — so the
decision to update is informed. It ships without the apply action (slice 002).

## Solution

Add a small server module that reads git state in the repo root and a read-only **Updates**
section in Settings that renders it. A "Check for updates" button re-runs `git fetch` + status.

## Technical Design

### API Changes

New router `server/src/routes/update.ts`, mounted in `index.ts` alongside the others.

`GET /api/update/status` → `200 UpdateStatus`:

```ts
interface UpdateStatus {
  git: boolean;          // false when repo root is not a git work tree
  branch: string | null; // current branch, e.g. "main"
  upstream: string | null; // tracking ref, e.g. "origin/main", or null if none
  currentCommit: string | null; // short SHA
  version: string | null;  // package.json "version" at repo root
  behind: number;        // commits upstream is ahead of HEAD
  ahead: number;         // commits HEAD is ahead of upstream
  dirty: boolean;        // git status --porcelain non-empty
  fetchedAt: string;     // ISO timestamp of the fetch attempt
  fetchError: string | null; // message if git fetch failed (offline, auth), else null
}
```

- Never throws to the client for expected conditions: non-git checkout → `{ git: false, … }`
  with the rest null/0; a failed `git fetch` → populated local fields + `fetchError` set (status
  still 200 so the UI can show "couldn't reach remote" without an error banner).
- Demo mode (`isDemo()`): return `{ git: false, fetchError: "unavailable in demo mode", … }` —
  no git calls.

### Architecture

- **`server/src/update.ts`** (new): `getUpdateStatus(): Promise<UpdateStatus>`. Reuse the
  `promisify(execFile)` git pattern already in `worktree.ts` (arg arrays, no shell — no
  interpolation). Resolve the repo root from `config.ts`: export the existing
  `ROOT` constant as `repoRoot()` (currently `path.resolve(__dirname, "..", "..")`) rather than
  recomputing it. Commands, all run with `cwd: repoRoot()`:
  - `git rev-parse --is-inside-work-tree` → gates everything; false → `{ git: false }`.
  - `git fetch --quiet` with a short timeout (e.g. 15s); catch → `fetchError`.
  - `git rev-parse --abbrev-ref HEAD` → branch; `git rev-parse --short HEAD` → currentCommit.
  - `git rev-parse --abbrev-ref --symbolic-full-name @{u}` → upstream (null on error).
  - `git rev-list --count @{u}..HEAD` → ahead; `git rev-list --count HEAD..@{u}` → behind
    (both 0 when no upstream).
  - `git status --porcelain` → dirty when non-empty.
  - version: read `<repoRoot>/package.json` and parse `.version`.
- **`routes/update.ts`** (new): the `GET /api/update/status` handler; `export const updateRouter`.
- **`index.ts`**: `import { updateRouter }` and `app.use(updateRouter)`.
- **`web/src/types.ts`**: add `UpdateStatus` (mirror server type).
- **`web/src/api.ts`**: `updateStatus: () => getJson<UpdateStatus>("/api/update/status")`.
- **`web/src/components/Settings.tsx`**: add `"update"` to `SectionKey`, an entry to `SECTIONS`
  (`{ key: "update", label: "Updates", icon: Download }` — `Download` is already imported), and
  an `UpdateSection` component rendered when `section === "update"`. It fetches `api.updateStatus()`
  on mount, shows version + branch + commit, an up-to-date badge or "N commits behind" prompt, a
  dirty-tree warning ("commit or stash local changes before updating"), a `fetchError` note if
  set, and a "Check for updates" button that re-fetches. No apply button in this slice.

### Data Model

None. No config field, no persisted state — status is computed live from git on each request.

## Security Considerations

- All git invocations use `execFile` with argument arrays (no shell), so no command injection —
  consistent with `worktree.ts` (see `THREAT_MODEL.md`). No user input reaches the git args.
- Read-only: `fetch`, `rev-parse`, `rev-list`, `status` mutate nothing in the work tree.
- Endpoint is localhost-only behind the existing CORS restriction; no new surface.

## Feature Flag

None — slice is user-ready on merge.

## Verification Criteria

### Unit Tests (`server/src/__tests__/update.test.ts`)
- [ ] `getUpdateStatus` in a non-git dir → `{ git: false }`, no throw.
- [ ] In a temp git repo with a remote set behind by N commits → `behind === N`, `ahead === 0`,
      `dirty === false`, `version` matches the repo `package.json`.
- [ ] Uncommitted change present → `dirty === true`.
- [ ] `git fetch` failure (bogus remote) → local fields populated, `fetchError` non-null, no throw.
- [ ] Demo mode → `{ git: false, fetchError: "unavailable in demo mode" }`, no git spawned.

### Integration Tests (`server/src/__tests__/index.update.test.ts`)
- [ ] `GET /api/update/status` → 200 with an `UpdateStatus`-shaped body.

### Manual
- [ ] `npm run dev`, Settings → **Updates**: version/branch/commit render; "Check for updates"
      re-fetches; on a behind branch the "N commits behind" prompt shows.

## Out of Scope
- Applying the update (slice 002).
- Any self-restart or process-manager change (see README run-model note).
