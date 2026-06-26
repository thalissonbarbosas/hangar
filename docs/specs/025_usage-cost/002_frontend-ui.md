# Slice 002 — Frontend UI

## Trunk Metadata
- **Type:** feat
- **Flag:** `none`
- **Complexity:** med
- **Issue:** — (filled by `/issues`)
- **Branch (post-/issues):** `feat/<issue-number>-usage-cost-frontend`
- **Depends on:** 001

## Problem

With the backend API in place, there is no UI to trigger it. Users need an icon in the Hangar topbar that opens a usage cost panel.

## Solution

1. Add a `CircleDollarSign` icon button to `topbar-actions` in `App.tsx`, **to the left of** the existing "Run a skill" (`Sparkles`) button.
2. The button toggles a new `"usage"` overlay value.
3. Create `web/src/components/UsageCost.tsx` — the overlay component — that:
   - On first load calls `GET /api/usage/status`
   - If `installed: false`: renders an "Install ccusage" CTA button (calls `POST /api/usage/install`)
   - If `installed: true`: renders a tab bar + results table + date filters

## Technical Design

### Architecture

**`web/src/App.tsx`** — three small changes:
1. Import `CircleDollarSign` from `lucide-react`
2. Import `UsageCostOverlay` from `./components/UsageCost`
3. Add the icon button before `<Sparkles>` in the `topbar-actions` div
4. Render `<UsageCostOverlay>` when `overlay === "usage"` (same pattern as `overlay === "settings"`)

**`web/src/api.ts`** — three new entries on the `api` object:
```ts
usageStatus: () => getJson<{ installed: boolean; version: string | null }>("/api/usage/status"),
usageData: (params: UsageParams) => getJson<unknown>(`/api/usage/data?${new URLSearchParams(params)}`),
usageInstall: () => sendJson<{ ok: boolean; output: string }>("POST", "/api/usage/install", {}),
```

**`web/src/components/UsageCost.tsx`** — new component `UsageCostOverlay`:

```
┌─ Usage Cost ────────────────────────────────────────────────────────────────┐
│  [Daily] [Monthly] [Weekly] [Blocks] [Session]    Since [________] Until [________] [Run] │
├─────────────────────────────────────────────────────────────────────────────┤
│  Period       Input     Output    Cache Read   Cost                         │
│  2026-06-25   70 047    259 572   16 610 306   $22.72                       │
│  …                                                                           │
│                              Total: $xx.xx                                   │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Blocks tab** gets two extra toggles: `[ ] Active only` and `[ ] Recent (3d)`.

**Not-installed state:**
```
⚠ ccusage is not installed
ccusage provides Claude Code usage data grouped by day, month, billing block, and session.

[Install ccusage globally]
```

### Component State

```ts
type Mode = "daily" | "monthly" | "weekly" | "blocks" | "session";

const [installed, setInstalled]   = useState<boolean | null>(null); // null = loading
const [mode, setMode]             = useState<Mode>("daily");
const [since, setSince]           = useState("");
const [until, setUntil]           = useState("");
const [activeOnly, setActiveOnly] = useState(false);
const [recent, setRecent]         = useState(false);
const [data, setData]             = useState<unknown>(null);
const [loading, setLoading]       = useState(false);
const [error, setError]           = useState<string | null>(null);
const [installing, setInstalling] = useState(false);
```

Data fetch fires on mount (when installed) and on "Run" button click. Results are the raw JSON from ccusage, rendered as a simple `<table>` with columns appropriate to the mode.

### Data Rendering

Each mode's JSON has a top-level key matching the mode name (`daily`, `monthly`, etc.) containing an array of rows. Common columns across all modes:

| Column | JSON field |
|--------|-----------|
| Period | `period` |
| Input tokens | `inputTokens` |
| Output tokens | `outputTokens` |
| Cache read | `cacheReadTokens` |
| Cost | `totalCost` (formatted `$x.xx`) |

`blocks` mode: adds `startTime`, `endTime` columns; shows "Active" badge when no `endTime`.

Totals row: summed `totalCost` shown at bottom of table.

## Security Considerations

- All API calls go to localhost; no cross-origin risk.
- Date inputs are validated before sending (regex `YYYY-MM-DD`); invalid values clear the param and show an inline error rather than reaching the server.
- No PHI rendered; data is token counts and dollar costs.

## Feature Flag

None — slice is user-ready on merge.

## Verification Criteria

### Unit Tests

- [ ] `UsageCostOverlay` renders loading spinner while `installed === null`
- [ ] `UsageCostOverlay` renders install CTA when `installed === false`
- [ ] Install button calls `api.usageInstall()` and re-fetches status on success
- [ ] Tab click changes `mode` state and re-fetches data
- [ ] "Run" button with valid since/until builds correct query params
- [ ] Invalid date input (e.g. `"not-a-date"`) shows inline error, does not call API
- [ ] Data table renders expected columns for `daily` mode
- [ ] Blocks tab shows "Active only" and "Recent" toggles
- [ ] Cost column displays two decimal places (e.g. `$22.72`)
- [ ] Totals row sums `totalCost` across all rows

### E2E Tests

- [ ] Click usage icon → overlay opens; tab bar visible
- [ ] With ccusage installed: default "Daily" data loads and renders at least one row
- [ ] Switch to "Blocks" tab → table re-fetches and renders block rows
- [ ] Apply since date → request includes `since` param, results scoped correctly
- [ ] Click X / re-click icon → overlay closes

## Out of Scope

- Per-project cost breakdown (requires upstream ccusage support)
- Export / copy-to-clipboard of the table
- Cost trend chart / visualisation
- Custom `--timezone` selector (uses system timezone by default)
- The `--token-limit` warning threshold option (blocks-only, niche)
