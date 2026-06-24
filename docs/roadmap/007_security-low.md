# Phase 007 — Security: LOW Priority Fixes

## Context

Two LOW-severity items from `docs/THREAT_MODEL.md`. Independent of the route splitting work
(different files). Can be done in parallel with Phase 006 or after it — no file overlap with
the route modules.

## Trunk Alignment

Both tasks ship directly on merge. No feature flags.

## Tasks

### Task 1: Restrict `.hangar/` directory permissions to 0700

- **Type:** security
- **Files:** `server/src/store.ts`
- **Dependencies:** None (independent of all other phases)
- **Verification:** `npm run typecheck`; start server fresh; `ls -la` confirms `.hangar/` is `drwx------`
- **Feature flag:** none
- **Estimated complexity:** Low

Addresses Threat 14 (backup tools / other OS users reading transcript files).

In `store.ts`, when `DATA_DIR` is created, pass `{ mode: 0o700 }`:

```typescript
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
}
```

Also apply `0o700` to the `runs/`, `workflows/`, and `aiwf/` subdirectories on creation.
Existing `.hangar/` installs are not retroactively changed — note this in the PR: operators
with existing data can run `chmod 700 .hangar/` manually.

---

### Task 2: GDPR run retention policy

- **Type:** feat
- **Files:** `server/src/config.ts`, `server/src/types.ts`, `server/src/store.ts`, `web/src/components/SessionsView.tsx`, `hangar.config.example.json`
- **Dependencies:** None (independent — touches different files than Task 1)
- **Verification:** `npm run typecheck`; set `runRetentionDays: 1` in config; runs older than 1 day are deleted on startup; "Delete transcript" button appears on done/stopped/error runs in the Sessions view
- **Feature flag:** none
- **Estimated complexity:** Medium

Addresses Threat 15 (GDPR retention obligation).

**`types.ts`** — add to `HangarConfig`:
```typescript
runRetentionDays?: number; // undefined = keep forever
```

**`config.ts`** — add to `validateConfig`:
```typescript
runRetentionDays: typeof config.runRetentionDays === "number"
  ? Math.max(1, config.runRetentionDays)
  : undefined,
```

**`store.ts`** — add `sweepOldRuns(retentionDays: number)` called from the startup path in
`index.ts` (alongside `loadPersistedRuns`). Deletes run JSON files whose `completedAt`
timestamp is older than `retentionDays` days and whose state is terminal (`done`, `error`,
`stopped`). Never deletes `running` or `queued` runs.

**`SessionsView.tsx`** — add a "Delete transcript" button (trash icon, ghost-danger style) on
terminal runs that calls `DELETE /api/runs/:id`. The button already exists conceptually (the
API endpoint exists); this makes it visible in the UI so operators can exercise the right to
erasure without needing API access.

**`hangar.config.example.json`** — add commented-out example:
```json
// "runRetentionDays": 90
```

## Execution Order

Tasks 1 and 2 have no file overlap — dispatch in parallel.

## Phase Checklist

- [ ] `.hangar/` and subdirs created with `mode: 0o700`
- [ ] `runRetentionDays` field added to `HangarConfig` and `validateConfig`
- [ ] `sweepOldRuns` runs at startup when `runRetentionDays` is configured
- [ ] "Delete transcript" button visible on terminal runs in Sessions view
- [ ] `npm run typecheck` passes
- [ ] `THREAT_MODEL.md`: move items 7, 8 from "Required" to "Implemented"
- [ ] `README.md`: add a note under "Security & deployment" that Jira ticket content is sent to Anthropic's API (GDPR transparency)
