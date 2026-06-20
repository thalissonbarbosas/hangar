# Spec 005 — Card options on the AI Workflow board: archive, delete, see data

## Trunk Metadata

- **Type:** feat
- **Issue:** (none)
- **Ticket:** HAN-12 — Add options to AIWF task: archive, delete, see data
- **Slug:** aiwf-task-options

## Problem

On the AI Workflow phase board, a card (a work **thread** or a manual **task**) can be created,
dragged between phase columns, and — for threads — have a skill run on it. But once a card exists
there is **no way to manage it**: you cannot remove a card you no longer want, you cannot get it
off the active board without deleting it, and there is no way to inspect the card's full underlying
data (its frontmatter fields, body, and complete run history) — the board only shows the title and a
truncated `phase·/skill` trail (last 4 entries).

The operator wants three per-card actions:

1. **See data** — open the card's full data: its key, title, status/phase, kind, current skill, PR
   link (if any), the description body, and the **complete** history log (every recorded
   session/task with phase, skill, timestamp, and summary).
2. **Archive** — soft-hide a card from the active board without deleting it (reversible:
   **Unarchive** restores it to its column).
3. **Delete** — permanently remove the card file from disk (with a confirm).

## Approach

Cards are flat-frontmatter markdown files at `<HANGAR_DATA_DIR>/aiwf/<projectId>/board/<KEY>.md`
managed entirely in `server/src/aiwf.ts` (parse/serialize/list/transition/get/append-history). Add
two operations alongside the existing ones and surface them through new routes and a per-card menu in
the web board. **See data** needs no new endpoint — the `Ticket` returned by `listCards` already
carries every field the modal shows (`key`, `summary`, `status`, `kind`, `skill`, `prUrl`,
`description`, `history`), so the modal renders from the in-memory card.

**Archive** is a soft flag, not a phase. Adding it as a board column or reusing `status` would
conflate it with the lifecycle phase and lose the card's real phase. Instead store an `archived`
frontmatter key (`archived: true`). `listCards` continues to return **all** cards (archived included)
and each `Ticket` gains an `archived?: boolean`; the **web** filters archived cards out of the phase
columns and shows them in a separate collapsible **Archived** section with Unarchive / See data /
Delete. This keeps the server list symmetric and testable while the board stays clean.

**Delete** unlinks the card file. History/run records elsewhere are unaffected (runs live under
`<DATA_DIR>/runs/`); only the board card is removed.

### Server (`server/src/aiwf.ts`)

- `cardToTicket(...)` — set `archived: true` on the Ticket when `fm.archived === "true"` (omit the
  field otherwise, so non-archived cards serialize without the key).
- `setCardArchived(project, key, archived: boolean): void` — locate the card file (reuse
  `findCardFile`), parse, set `fm.archived = "true"` when archiving or **delete** the key when
  unarchiving (so `serializeCard` does not emit an empty value), and rewrite the file. Throw
  `Card not found: <key>` when missing, mirroring `transitionCard`.
- `deleteCard(project, key): boolean` — locate the card file; `fs.rmSync`/`unlinkSync` it; return
  `true` if a file was removed, `false` if none was found. Demo mode is read-only — see routes.

Note: `serializeCard` already drops empty/undefined frontmatter values, but since `archived: false`
should produce **no** key at all, unarchive must remove the key rather than set it to `"false"`.

### Server types (`server/src/types.ts`)

- Add `archived?: boolean;` to `Ticket` (aiwf-only; document it inline like the other aiwf fields).

### Server routes (`server/src/index.ts`)

Add next to the existing `/api/aiwf/projects/:id/cards/:key/*` routes, using the existing
`requireAiwfProject(res, id)` guard:

- `POST /api/aiwf/projects/:id/cards/:key/archive` — body `{ archived: boolean }` (coerce/default to
  `true`). Demo mode returns `{ ok: true }` without touching disk. Calls `setCardArchived`; 200
  `{ ok: true }` on success; 400 with the error message when the card is not found (mirroring the
  `transition` route's 400-on-throw).
- `DELETE /api/aiwf/projects/:id/cards/:key` — Demo mode returns `{ ok: true }`. Calls `deleteCard`;
  200 `{ ok: true }` when a card was removed; 404 `{ error: "No such card" }` when none was found.

### Web types + API (`web/src/types.ts`, `web/src/api.ts`)

- `web/src/types.ts` — add `archived?: boolean;` to `Ticket` (mirror the server type).
- `web/src/api.ts` —
  - `archiveAiwfCard(id, key, archived: boolean)` → `POST .../cards/:key/archive` `{ archived }`.
  - `deleteAiwfCard(id, key)` → `DELETE .../cards/:key`.

### Web board (`web/src/components/AiWorkflow.tsx`)

- **Per-card menu.** Add a `⋯` (`MoreVertical`) options button to `AiwfCard` opening a small popover
  with: **See data**, **Archive** (or **Unarchive** when `card.archived`), **Delete** (danger,
  `window.confirm` first). The menu button and popover must **not** start a card drag — guard with
  `onMouseDown`/`onDragStart` `stopPropagation` (the card root is `draggable`), and close the popover
  on outside-click (mirror `OptionsMenu`'s `ref` + `mousedown` listener pattern).
- **Wire actions** in `AiWorkflowView`: `archiveCard(key, archived)` calls `api.archiveAiwfCard` then
  `loadCards`; `removeCard(key)` calls `api.deleteAiwfCard` then `loadCards`. Optimistic update is
  optional but reload-after is required so the board reflects disk state.
- **Filter archived from columns.** Compute the per-column card lists from
  `cards.filter((c) => !c.archived)`; the column `count` reflects only non-archived cards. The
  `extra` (unknown-status) column computation must also ignore archived cards.
- **Archived section.** Below the columns, render a collapsible **Archived (N)** section listing the
  archived cards (compact rows: key + title) each with **See data**, **Unarchive**, **Delete**.
  Hidden entirely when there are no archived cards.
- **CardDataModal.** A read-only modal (reuse the `modal-overlay`/`modal aiwf-modal` markup) showing:
  key, title, status, kind, skill (if any), PR link (if any, as an external link), archived flag,
  the full description body (or a muted "No description"), and the **full** history list — each entry
  as `phase · /skill`, a human time from `entry.at`, and `entry.summary` when present. Empty history
  shows a muted "No runs yet".
- Add any needed CSS to `web/src/styles.css` for the card menu popover / archived section, mirroring
  the existing `aiwf-options-pop` / `aiwf-opt` styling so it matches the toolkit's look.

### Docs

- `docs/ai-workflow.md` — add the two new routes to the API table; in **The phase board** document
  the per-card options (See data / Archive / Delete) and the Archived section; note the `archived`
  frontmatter key in the card-file-format section.
- `README.md` — one lean line in the AI Workflow blurb mentioning per-card archive/delete/see-data
  (keep the README an overview; details live in `docs/ai-workflow.md`).
- `CHANGELOG.md` — one **Added** entry under `[Unreleased]`; bump root `package.json` `version`
  (MINOR: `0.7.1` → `0.8.0`, a notable feature).

## Out of scope

- Editing a card's title/body/skill in place (this is view + archive + delete only).
- Bulk actions, archive of whole columns, or an archive retention policy.
- Server-side filtering of archived cards (the list stays symmetric; the web filters).

## Verification Criteria

1. `POST /api/aiwf/projects/:id/cards/:key/archive` with `{ archived: true }` sets the flag; a
   follow-up `GET .../cards` returns that card with `archived: true`. Sending `{ archived: false }`
   clears it (the card returns without `archived`/with `archived` falsy) and the `archived` key is
   gone from the file.
2. The archive route returns 400 (with an error message) for an unknown card key, and the project
   guard returns 404 for an unknown project id.
3. `DELETE /api/aiwf/projects/:id/cards/:key` removes the card file (a follow-up `GET .../cards` no
   longer lists it) and returns 200 `{ ok: true }`; deleting a non-existent card returns 404; an
   unknown project id returns 404.
4. Demo mode: both routes return success without throwing or writing to disk.
5. UI: each card shows a `⋯` options menu with See data / Archive / Delete; opening the menu or
   clicking an item does **not** drag the card. Archiving removes the card from its column and moves
   it into the **Archived** section; Unarchive restores it to its phase column. Delete (after a
   confirm) removes the card from the board.
6. UI: **See data** opens a modal showing the card's key, title, status, kind, skill, PR (if any),
   description, and the full history list.
7. `npm run typecheck`, `npm run lint`, `npm test`, and `npm run format:check` all pass.
