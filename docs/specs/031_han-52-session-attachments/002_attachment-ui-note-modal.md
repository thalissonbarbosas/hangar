# Feature: Attachment UI — run note (NoteModal)

## Problem

Slice 001 gives the backend a way to store an uploaded file and deliver its path to the agent,
but nothing calls it. This slice adds the first user-facing flow: **drag a file onto the run
note, see it as a chip, and have its path delivered to the session** when the operator clicks
Run. It also introduces the single reusable `AttachmentBar` component that slice 003 will reuse.

## Solution

Add `AttachmentBar` — a drop target with a chip list — and place it inside `NoteModal`. On
drop, each file's bytes are uploaded via `api.uploadAttachment`; the returned absolute path is
kept in local state and passed as `attachments` to `startRun`. This depends on **slice 001**
being merged.

## Technical Design

### API Changes

None server-side (slice 001 added them). Client wrappers only:

- **`web/src/api.ts`** —
  - `uploadAttachment(file: File): Promise<{ path: string; name: string; size: number }>` — reads
    the file to base64 (`FileReader`/`arrayBuffer` → base64) and `POST`s `/api/attachments`.
  - Extend `startRun(...)` (and the standalone/note variants that take `note`) with an optional
    `attachments?: string[]` argument, added to the POST body.

### Data Model

Client-only local state — a `useAttachments` list of `{ path, name, size }`. No persistence.

### Architecture

- **`web/src/components/AttachmentBar.tsx`** (new) — reusable, controlled:
  - Props: `attachments: Attachment[]`, `onAdd(files: File[])`, `onRemove(path: string)`,
    optional `disabled`.
  - Renders a drop zone (`onDragOver` preventDefault + `dragging` class, `onDrop` reads
    `e.dataTransfer.files`) and a row of chips (filename + size + `X` remove button, `lucide-react`
    `Paperclip`/`X`). Also offers a click-to-browse `<input type="file" multiple hidden>` fallback
    so attaching works without a drag (same `onAdd`).
  - Shows a per-file **uploading** state while `uploadAttachment` is in flight and an error state
    if it rejects (chip marked failed, removable). Pure presentational + callbacks; it does not
    call the API itself.
- **`web/src/hooks/useAttachments.ts`** (new, or a small helper co-located in `AttachmentBar`) —
  owns the list + the upload orchestration: `add(files)` calls `api.uploadAttachment` per file,
  appends succeeded ones, tracks in-flight/failed; `remove(path)`; `paths()` → `string[]` for the
  submit call; `reset()`.
- **`web/src/components/NoteModal.tsx`** — render `<AttachmentBar>` between the hint and the
  actions; on Run, pass `attachments: paths()` to the existing `onRun`. Extend `onRun` to
  `(note: string, attachments: string[])` and update the single call site (`App.tsx` /
  wherever `NoteModal` is used) to forward `attachments` into `startRun`.
- **`web/src/types.ts`** — add an `Attachment = { path: string; name: string; size: number }`
  type (mirrors the server response); keep in sync with `server/src/types.ts`.
- **`web/src/styles.css`** — `.attachment-bar` (drop zone: dashed border, `dragging` highlight),
  `.attachment-chip` (name + size + remove), reusing existing token variables (`--bg`, `--fg`,
  `--accent`). No new dependency.

### Component reuse

`AttachmentBar` + `useAttachments` are written here to be surface-agnostic so slice 003 drops
them into the resume and composer inputs unchanged — the same pattern `AutoGrowTextarea` follows.

## Security Considerations

Reference `docs/THREAT_MODEL.md`. No `dangerouslySetInnerHTML` — filenames render as text.
File bytes are sent to the same-origin server (CORS already restricts origins). Upload size is
enforced server-side (slice 001); the client may also short-circuit oversized files before upload
for a nicer message, but the server remains the authority. No new trust boundary.

## Feature Flag

None — user-ready on merge. Depends on slice 001; delivers a complete drag-a-file-onto-the-note
flow. `main` stays deployable.

## Verification Criteria

*`web/` has no test runner (`CLAUDE.md`); gate with `typecheck` + `lint` + `format:check` +
`npm --prefix server test`, plus manual UI checks.*

### Type / Lint / Format Gates
- [ ] `npm run typecheck` exits 0 with `AttachmentBar` typed and `Attachment` mirrored in
      `web/src/types.ts`; `startRun`/`onRun` updated at their call sites.
- [ ] `npm run lint` and `npm run format:check` exit 0.
- [ ] `npm --prefix server test` exits 0 (server untouched by this slice).

### Manual UI Verification
- [ ] Assign an agent/skill to a card → NoteModal opens with an `AttachmentBar`.
- [ ] **Drag a file** onto the bar → chip appears (name + size); dropping shows an uploading
      state then settles. File saved under `.hangar/attachments/<uuid>/<name>`.
- [ ] **Click-to-browse** attaches the same way.
- [ ] Removing a chip drops it from the list.
- [ ] Click **Run** → session starts and the agent's opening prompt contains the
      `Attachments:` block with the saved absolute path (verify in the RunPanel transcript /
      persisted run).
- [ ] Runs correctly in **both** terminal and classic session themes.

## Out of Scope

- Resume + composer inputs — slice 003 (reuses this component).
- Attachment cleanup/retention (inherited from slice 001's Out of Scope).
- Image/preview thumbnails — chips are name + size only.
- Paste-to-attach (clipboard) — drag + click-to-browse only.

## Trunk Metadata
- **Type:** feat
- **Flag:** `none`
- **Complexity:** med
- **Issue:** — (filled by `/issues`)
- **Branch (post-/issues):** `feat/<issue-number>-attachment-ui-note-modal`
