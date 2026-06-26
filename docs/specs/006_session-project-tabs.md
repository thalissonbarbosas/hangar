# Spec 005.B — Group sessions by project with tabs

## Trunk Metadata

- **Type:** feat
- **Issue:** (none filed)
- **Ticket:** HAN-16 — Add tabs to group sessions by projects in sessions page
- **Slug:** session-project-tabs

## Problem

The Sessions page (`web/src/components/SessionsView.tsx`) renders every run in one flat,
chronologically-sorted list. An operator who runs Hangar across several projects (Jira boards like
**PracticePal**/**Integrations** plus AI Workflow projects like **Hangar**/**Dynamic Core**) cannot
focus on one project's sessions — they have to scan the whole list and read each ticket key to tell
which project a run belongs to. The ticket asks for **tabs that group sessions by project**, so the
operator can switch to a project and see only its sessions.

## Approach

Add a tab bar to the Sessions page that filters the run list by **project**. No server change is
required: the run summary already carries everything needed to resolve a run's project, and the Web
app already holds the board + AI Workflow project config.

**Resolving a run's project.** For each run, derive a `{ key, label }`:

1. **AI Workflow run** — if the run has `aiwfProjectId` set, look it up in the AI Workflow projects;
   the project's `name` is the label and its `id` the key. (Runs already send `aiwfProjectId` over
   the wire via the server's `runToJson` spread; it is currently just untyped on the Web side.)
2. **Jira-board run** — otherwise take the prefix of `ticketKey` (everything before the trailing
   `-<number>`, e.g. `PP-123` → `PP`). If that prefix matches a configured board `key`, use the
   board `name` as the label; otherwise fall back to the prefix string itself as both key and label
   (covers boards not currently in config).
3. **Ad-hoc run** — a run with no `ticketKey` (standalone/skill runs) groups under a single
   **"Ad-hoc"** bucket with a stable key (e.g. `__adhoc__`).

**Tabs.** Render a horizontal tab bar between the Sessions header and the list:

- An **"All"** tab first, showing the total run count, always present.
- One tab per distinct project **present in the current runs**, each labelled `Name` with its run
  count. Order project tabs by descending run count, ties broken alphabetically by label; the
  Ad-hoc tab sorts last.
- The active tab is component state, defaulting to **"All"**. Selecting a tab filters the rendered
  list to that project's runs (preserving the existing active-first, newest-first sort). If the
  active tab's project disappears from `runs` (e.g. its last session is cleared), fall back to
  **"All"** so the view never goes blank.
- When only one project is present (the common single-project case) the tab bar may still render
  ("All" + that one project) — keep it simple; do not special-case hiding it.

**Header & clear actions are unchanged.** The `active · total` hint and the Clear finished / Clear
all buttons continue to reflect and operate on **all** runs (not the filtered subset), matching
today's behavior. Per-tab counts live on the tabs themselves. The per-tab empty state reuses the
existing `.empty` styling with a project-aware message.

Wire `boards` and `aiwfProjects` (already in `App.tsx` state) into `SessionsView` as new props so it
can resolve labels. Keep the project-resolution logic as a small pure helper inside the component
file so it is unit-testable and easy to read.

## Affected Files

### Web

- `web/src/types.ts` — add `aiwfProjectId?: string;` to `RunSummary` (already sent by the server;
  just type it).
- `web/src/components/SessionsView.tsx` —
  - Accept new props `boards: BoardConfig[]` and `aiwfProjects: AiwfProject[]`.
  - Add a pure `projectOf(run, boards, aiwfProjects): { key: string; label: string }` helper and a
    `groupByProject(runs, …)` / tab-derivation helper.
  - Render the tab bar and filter the list by the active tab; manage `activeTab` state with the
    fall-back-to-All behavior.
- `web/src/App.tsx` — pass `boards={boards}` and `aiwfProjects={aiwfProjects}` to `<SessionsView />`.
- `web/src/styles.css` — styles for the tab bar (`.sessions-tabs`, active state, count badge),
  matching the existing visual language (reuse chip/badge patterns already in the file).

### Docs

- `docs/specs/005_session_project_tabs.md` — this spec.

> No CHANGELOG / version bump: `origin/main` has no CHANGELOG.md and the trunk CLAUDE.md no longer
> mandates one. Do not reintroduce it.

## Verification Criteria

1. With runs spanning multiple projects, the Sessions page shows an **All** tab plus one tab per
   project, each with a correct run count; **All** equals the total.
2. Selecting a project tab shows only that project's runs; selecting **All** shows every run. The
   existing active-first, newest-first ordering is preserved within the filtered list.
3. An AI Workflow run (has `aiwfProjectId`) is grouped under its **project name**, not its raw key
   prefix.
4. A Jira-board run is grouped under the board's **display name** when the board is configured, and
   under its key prefix otherwise.
5. Runs with no `ticketKey` group under a single **Ad-hoc** tab.
6. Clearing the last session of the active project tab falls back to **All** (no blank view); the
   header `active · total` counts and Clear buttons still operate over all runs.
7. `npm run typecheck` passes, and `npm test` (server tests) passes. The page is verified rendering
   in `HANGAR_DEMO=1 npm run dev` (demo seeds multi-project runs).
