# Spec 002 — Change an AI Workflow project's location

## Trunk Metadata

- **Type:** feat
- **Issue:** (none — ran before /issues)
- **Ticket:** HAN-5 — Add option to change the AI Workflow project location
- **Slug:** aiwf-project-location

## Problem

An AI Workflow project is a registered local repo whose board cards live in Hangar's data dir at
`<HANGAR_DATA_DIR>/aiwf/<projectId>/board/*.md`. Today the AI Workflow sub-bar lets you **create** a project
(new/adopt), **select** it, and **remove** it — but there is no way to **change an existing
project's location** (its `repoPath`). If the operator moves the repo on disk, renames the folder,
or registers it with the wrong path, the only recourse is to remove the project and re-add it. The
operator wants an **Edit** action on each project chip that lets them point the project at a new
location (and fix its display name) in place, without losing the registration.

## Approach

Add an in-place edit of a registered project. A registered project carries `id`, `name`,
`repoPath`, optional `columns`, and `createdAt`; editing changes `name` and/or `repoPath` while
keeping the same `id` (so the synthetic `boardKey` and any in-flight references stay stable). The
cards are not moved by Hangar — the board lives in Hangar's data dir keyed by `id`
(`<HANGAR_DATA_DIR>/aiwf/<projectId>/board`), so re-pointing `repoPath` leaves the cards untouched
and simply runs future work against the new location (the board dir is ensured to exist on save,
mirroring the create path).

A new `PATCH /api/aiwf/projects/:id` route validates the same way the create route does — the new
`repoPath` must exist on disk — and persists through the existing `saveAiwfProjects` (which already
sanitizes and hot-swaps the in-memory config). The Web sub-bar gains a pencil button next to each
project's remove (✕) button that opens an **Edit project** modal with the same live path-validation
the New-project wizard uses.

## Affected Files

### Server

- `index.ts` — add `PATCH /api/aiwf/projects/:id`: 404 unknown project; 400 when neither `name` nor
  `repoPath` is supplied; 400 when a supplied `repoPath` does not exist; 200 with the updated project
  (+ resolved `columns`) on success. Ensures the board dir exists for the new path. Demo mode echoes
  the merged project without touching disk.

### Web

- `api.ts` — `updateAiwfProject(id, fields: { name?; repoPath? })` wrapper (`PATCH`).
- `components/AiWorkflow.tsx` — a pencil **Edit** button on each project chip (next to remove) that
  opens an `EditProjectModal` (name + location fields, live path check, Save). On success reload and
  keep the project selected.

### Docs

- `docs/ai-workflow.md` — add the `PATCH /api/aiwf/projects/:id` row to the API table and note the
  Edit action in the Projects section.
- `README.md` — mention editing a project's location in the AI Workflow blurb (kept lean).
- `CHANGELOG.md` + root `package.json` version bump (MINOR — notable feature).

## Verification Criteria

1. `PATCH /api/aiwf/projects/:id` updates `name` and `repoPath` and persists them (a follow-up
   `GET /api/aiwf/projects` reflects the change).
2. The route returns 404 for an unknown project id.
3. The route returns 400 when neither `name` nor `repoPath` is provided.
4. The route returns 400 when the supplied `repoPath` does not exist on disk, and does **not** mutate
   the stored project.
5. Editing only the `name` (no `repoPath`) succeeds and leaves `repoPath` unchanged; editing only the
   `repoPath` succeeds and leaves `name` unchanged.
6. UI: each project chip shows an **Edit** button that opens a modal pre-filled with the current name
   and location; saving a valid change updates the chip and keeps the project selected.
7. `npm run typecheck` and `npm test` pass.
