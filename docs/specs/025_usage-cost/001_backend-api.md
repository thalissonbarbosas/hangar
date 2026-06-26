# Slice 001 — Backend API

## Trunk Metadata
- **Type:** feat
- **Flag:** `none`
- **Complexity:** low
- **Issue:** — (filled by `/issues`)
- **Branch (post-/issues):** `feat/<issue-number>-usage-cost-backend`

## Problem

There is no server-side way to check whether `ccusage` is installed or to run it and return structured JSON to the browser. The frontend needs two things: an install-status check (to show the install CTA) and a data-fetch endpoint (to populate the usage panel).

## Solution

Add a new route module `server/src/routes/usage.ts` with three endpoints and register it in `server/src/index.ts`.

## Technical Design

### API Changes

**`GET /api/usage/status`**
- Runs `npx ccusage --version` (or checks `ccusage` in PATH via `which ccusage`)
- Response `200`:
  ```json
  { "installed": true,  "version": "20.0.14" }
  { "installed": false, "version": null }
  ```

**`GET /api/usage/data`**

Query parameters:

| Param | Values | Default |
|-------|--------|---------|
| `mode` | `daily` \| `monthly` \| `weekly` \| `blocks` \| `session` | `daily` |
| `since` | `YYYY-MM-DD` | — |
| `until` | `YYYY-MM-DD` | — |
| `active` | `true` | — (blocks-only: show current active block) |
| `recent` | `true` | — (blocks-only: last 3 days) |

- Builds args array from validated params → `execFileAsync("ccusage", [mode, "--json", "--no-color", ...args])`
  > **Note:** `ccusage` is invoked directly (not via `npx`) so that `ENOENT` propagates cleanly when the binary is absent. Using `npx ccusage` would silently download the package, defeating install detection.
- Passes `--no-color` always
- Returns `200` with the raw parsed JSON from ccusage stdout
- Returns `503 { error: "ccusage not installed" }` if the binary is absent (ENOENT)
- Returns `400 { error: "Invalid mode" }` for unknown modes
- Returns `500 { error: "...", raw: "..." }` on non-zero exit

**`POST /api/usage/install`**
- Runs `execFileAsync("npm", ["install", "-g", "ccusage"])` — fixed args array, no shell interpolation
- Returns `200 { ok: true, output: "..." }` on success
- Returns `500 { error: "...", raw: "..." }` on failure

### Data Model

No persistent state. All data comes live from `ccusage` on each request.

### Architecture

New file: `server/src/routes/usage.ts` — a single `Router` instance (`usageRouter`) following the same pattern as `server/src/routes/aiwf.ts`.

`server/src/index.ts` — add one import and one `app.use(usageRouter)` line (after `aiwfRouter`).

### Input Validation

- `mode` must be one of the five allowed values (enum check). Reject anything else with `400`.
- `since` / `until` must match `YYYY-MM-DD` or `YYYYMMDD` with calendar-valid month (01–12) and day (01–31). Reject bad formats with `400`.
- `active` / `recent` accepted only when `mode === "blocks"`.
- No user-supplied values are passed to a shell string — all values are pushed into an args **array** passed to `execFileAsync` (no shell interpolation).

## Security Considerations

- All shell execution uses `execFileAsync` with explicit argument arrays — no user input is ever interpolated into a shell string.
- The install endpoint (`POST /api/usage/install`) runs `npm install -g ccusage` with no user-controlled arguments. Hardcoded package name only.
- No PHI or secrets are involved; usage data is local token-count metadata.
- These endpoints are localhost-only (same as the rest of the Hangar server).

## Feature Flag

None — slice is user-ready on merge.

## Verification Criteria

### Unit Tests

- [ ] `GET /api/usage/status` when ccusage binary present → `{ installed: true, version: "x.y.z" }`
- [ ] `GET /api/usage/status` when ccusage binary absent → `{ installed: false, version: null }`
- [ ] `GET /api/usage/data?mode=daily` → calls `ccusage daily --json --no-color` (direct, not via npx), returns parsed JSON
- [ ] `GET /api/usage/data?mode=daily&since=2026-01-01` → args include `--since 2026-01-01`
- [ ] `GET /api/usage/data?mode=blocks&active=true` → args include `--active`
- [ ] `GET /api/usage/data?mode=invalid` → `400 { error: "Invalid mode" }`
- [ ] `GET /api/usage/data?mode=daily&since=not-a-date` → `400 { error: "Invalid since" }`
- [ ] `GET /api/usage/data` when ccusage not installed → `503 { error: "ccusage not installed" }`
- [ ] `POST /api/usage/install` success → `200 { ok: true, output: "..." }`
- [ ] `POST /api/usage/install` failure → `500 { error: "...", raw: "..." }`

### Integration Tests

- [ ] Full round-trip: status → data → results structure matches expected ccusage JSON shape

## Out of Scope

- Per-project filtering (not supported by ccusage; no `--project` flag or project-path in output)
- Caching responses (each call fetches live data)
- Websocket streaming of ccusage output
