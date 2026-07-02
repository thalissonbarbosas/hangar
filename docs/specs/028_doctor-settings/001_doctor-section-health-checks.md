# Feature: Doctor section + environment health checks

## Trunk Metadata
- **Type:** feat
- **Flag:** `none` — user-ready on merge
- **Complexity:** med
- **Issue:** — (filled by `/issues`)
- **Branch (post-/issues):** `feat/<issue-number>-doctor-section-health-checks`

## Problem

There is no single place in Hangar that reports the health of the operator's environment. When
something is off — no Claude auth, orphaned worktrees piling up under `.hangar/`, a bloated data
dir, Jira not configured — the operator finds out indirectly, mid-run. This slice adds the
**Doctor** Settings section and a set of read-only health checks so the state is visible at a
glance. (Session recovery — the operator's headline ask — lands in slice 002 on top of this.)

## Solution

Add a **Doctor** entry to the Settings nav (under the existing **System** group, alongside
Terminal and Updates). It fetches a new `GET /api/doctor` report and renders each check as a row
with an ok / warn / error status, a one-line detail, and an optional hint. A **Re-run checks**
button re-fetches. All checks are read-only — the Doctor never mutates anything in this slice.

## Technical Design

### API Changes

New route module `server/src/routes/doctor.ts`, mounted in `index.ts`:

- `GET /api/doctor` → `200 DoctorReport`
  - No params, no body. Read-only. Never throws to the client — a check that fails to evaluate
    is reported as its own `error`-status row rather than a 500.

```ts
type DoctorStatus = "ok" | "warn" | "error";
interface DoctorCheck {
  id: string;          // stable key, e.g. "auth", "worktrees", "disk"
  label: string;       // human title
  status: DoctorStatus;
  detail: string;      // one-line finding
  hint?: string;       // optional remediation guidance
}
interface DoctorReport {
  checks: DoctorCheck[];
  generatedAt: number; // epoch ms
}
```

Client wrapper in `web/src/api.ts` (uses the existing `getJson` helper):

```ts
doctor: () => getJson<DoctorReport>("/api/doctor"),
```

### Data Model

No config or persisted-schema changes. `DoctorCheck` / `DoctorReport` / `DoctorStatus` are new
shared types added to `server/src/types.ts` and mirrored in `web/src/types.ts`.

### Architecture

- **`server/src/doctor.ts`** (new) — `export async function runDiagnostics(): Promise<DoctorReport>`.
  Builds the checks below, each wrapped so one throwing check can't sink the report:
  - **`auth`** — Claude auth present: `ANTHROPIC_API_KEY` set, or `~/.claude` exists (host login).
    `ok` if either; `error` if neither (sessions can't start). Never reads/echoes the key value.
  - **`jira`** — Jira configured: reads current Jira settings (base URL + email + saved token).
    `ok` if all present; `warn` if partial/missing. No network call — a live test stays in the
    Jira section. Detail names which piece is missing.
  - **`worktrees`** — orphan scan across board repo roots + the durable `.hangar/worktrees/` dir:
    count live worktrees and orphans (git entries whose path is gone, or `.hangar/worktrees/`
    dirs not tied to any active run). `ok` when zero orphans; `warn` with the count otherwise.
    Reuses `worktree.ts` helpers (`git worktree list`); adds a read-only `listWorktreeOrphans`.
  - **`disk`** — `.hangar/` footprint (recursive byte sum of `runs/`, `workflows/`, `worktrees/`,
    `aiwf/`). `ok` under 500 MB, `warn` above, with a human-readable size in the detail.
  - **`runs`** — persisted-run summary: total, and how many are `stopped` / `error`. Always `ok`
    (informational); this row also seeds the operator's awareness for slice 002's recovery list.
- **`server/src/routes/doctor.ts`** (new) — `doctorRouter` with the single `GET /api/doctor`
  handler calling `runDiagnostics()`. Mounted in `index.ts` next to the other route modules.
- **`server/src/types.ts`** — add the three types (source of truth).
- **`web/src/types.ts`** — mirror them.
- **`web/src/api.ts`** — add the `doctor` wrapper.
- **`web/src/components/Settings.tsx`** — add `"doctor"` to `SectionKey`, a nav item
  `{ key: "doctor", label: "Doctor", icon: Stethoscope }` in the **System** group, the
  `{section === "doctor" && <DoctorSection />}` branch, and the `DoctorSection` component:
  fetch on mount + on **Re-run checks**, render check rows with a status icon
  (`ShieldCheck`/`AlertTriangle`/`AlertCircle` mapped from status), detail, and hint.

Follows `CLAUDE.md` → "Adding an API route" (route module + typed wrapper + types kept in sync).
Demo mode note: `runDiagnostics` reads config/env/disk only, so it works under `HANGAR_DEMO=1`.

## Security Considerations

Read-only and local-only, matching the existing trust model (`ARCHITECTURE.md` → "Security
posture"; `THREAT_MODEL.md`). Specific care:
- The `auth` check reports **presence only** — it never returns the API key value or token,
  avoiding secret exposure through the report (Threat: credential leakage).
- No path traversal: the disk/worktree checks walk only fixed, server-owned roots (`DATA_DIR`,
  configured board repo paths) — no client-supplied paths.
- No new mutation surface; `GET` only, so no CSRF-write concern beyond the existing CORS lock to
  `localhost:5180`.

## Feature Flag

None — the slice is user-ready on merge.

## Verification Criteria

### Unit / Integration Tests (server, `server/src/__tests__`)
- [ ] `runDiagnostics()` returns a report whose `checks` include ids `auth`, `jira`, `worktrees`,
      `disk`, `runs`, and a numeric `generatedAt`.
- [ ] `auth` check: with neither `ANTHROPIC_API_KEY` nor `~/.claude` present (stubbed) → `error`;
      with `ANTHROPIC_API_KEY` set → `ok`, and the detail does not contain the key value.
- [ ] `worktrees` check: with a fabricated orphan under a temp data dir → `warn` and the detail
      reports a non-zero orphan count; with none → `ok`.
- [ ] `disk` check: reports a human-readable size and is `ok` for a small temp data dir.
- [ ] `GET /api/doctor` → `200` with `{ checks: [...], generatedAt }`; a check that throws
      internally still yields a row (status `error`), not a `500`.

### Manual (demo mode: `HANGAR_DEMO=1 npm run dev`)
- [ ] Settings → **System → Doctor** shows the check rows with status icons; **Re-run checks**
      re-fetches and updates `generatedAt`.

### Gates (from `CLAUDE.md`)
- [ ] `npm run typecheck`, `npm run lint -- --max-warnings=2`, `npm --prefix server test`,
      `npm run format:check` all pass. Run `/smoke` before merging (server change).

## Out of Scope

- Recovering / resuming sessions — slice 002.
- Any mutating repair action (pruning orphans, clearing disk) — this slice only *reports*.
- Live Jira / network reachability probes — the Jira section already offers a live **Test**.
- Auto-scheduled or background health polling — checks run on demand only.
