# Feature: Attachment storage + delivery (backend)

## Problem

There is no way to attach a file to a session. Before any UI can be built, the server needs
(a) a place to receive an uploaded file and hand back a stable **absolute path**, and (b) a way
to carry a list of attachment paths through the two prompt-producing endpoints so the agent
sees them. This slice is backend-only and adds no user-visible behavior — it is the foundation
the UI slices (002, 003) build on.

## Solution

Add `POST /api/attachments` that persists uploaded file bytes under `.hangar/attachments/` and
returns the saved absolute path. Thread an optional `attachments: string[]` field through
`POST /api/runs` and `POST /api/runs/:id/message`, and render those paths as an `Attachments:`
block appended to the prompt the agent receives.

## Technical Design

### API Changes

**New: `POST /api/attachments`** — save one uploaded file, return its path.

- Body (JSON): `{ name: string, contentBase64: string }`. Base64 keeps it within the existing
  JSON pipeline (no `multer`/multipart dependency). The route mounts its own
  `express.json({ limit: "40mb" })` so it isn't constrained by the global ~100kb `express.json()`
  parser. (The limit sits above the 25 MB decoded cap × 4/3 base64 overhead ≈ 33.3 MB, so a
  file exactly at the cap still parses before the size check rejects oversized ones. Because the
  global `express.json()` in `index.ts` runs first, `index.ts` must skip it for this path — see
  Architecture — otherwise the global 100kb limit would `413` the upload before this parser runs.)
- Response `200`: `{ path: string, name: string, size: number }` — `path` is the absolute path
  of the saved file.
- Errors: `400` if `name` or `contentBase64` is missing/not a string, or the decoded size
  exceeds `MAX_ATTACHMENT_BYTES` (25 MB); `500` on write failure.

**Changed: `POST /api/runs`** — accept optional `attachments?: string[]` (absolute paths) in the
body, alongside the existing `note`. Passed through to `startRun`. Non-array or non-string
entries are ignored (filtered), never fatal.

**Changed: `POST /api/runs/:id/message`** — accept optional `attachments?: string[]` alongside
`text`. The `text`-required rule still holds **unless** attachments are present (attachments
alone may be sent). Filtered the same way.

### Data Model

No schema/persistence-format change to run records. New on-disk artifact only:

```
.hangar/attachments/<uuid>/<sanitized-name>   # uploaded file bytes, dir mode 0700
```

- `<uuid>` is `crypto.randomUUID()` (already available in Node 18+; used elsewhere for run ids).
- `<sanitized-name>` = `path.basename(name)` (strips any directory component / traversal); if it
  resolves to empty, fall back to `file`. Each upload gets its own `<uuid>` dir so identical
  filenames never collide.
- Storage helper lives in `store.ts` next to `DATA_DIR`:
  `saveAttachment(name: string, bytes: Buffer): { path, name, size }`.
- No cleanup in this slice (see Out of Scope) — files persist under the gitignored `.hangar/`.

### Architecture

- **`server/src/store.ts`** — add `ATTACHMENTS_DIR = path.join(DATA_DIR, "attachments")`
  (created with `{ recursive: true, mode: 0o700 }`, matching `DATA_DIR`) and export
  `saveAttachment()`.
- **`server/src/sessions.ts`** —
  - Add `attachments?: string[]` to the start-run options type and to the `buildPrompt` opts.
  - Add a `formatAttachments(paths: string[]): string` helper producing:
    ```
    Attachments (local file paths — read them as needed):
    - /abs/path/one.pdf
    - /abs/path/two.png
    ```
    Returns `""` for an empty/absent list. `buildPrompt` appends it (after the operator note,
    before the closing "Investigate…" line for tickets; after the note for standalone).
  - Extend `sendMessage(run, text, attachments?)` to append the same block to the outgoing
    message text when attachments are present. If `text` is empty and attachments exist, the
    message is just the attachments block. The mode-detection return value is unchanged.
- **`server/src/routes/runs.ts`** —
  - `POST /api/attachments` handler (mounts `express.json({ limit })` locally), calling
    `saveAttachment`.
  - Parse+filter `attachments` in `POST /api/runs` → pass to `startRun`.
  - Parse+filter `attachments` in `POST /api/runs/:id/message`; relax the empty-`text` guard when
    attachments are present; pass to `sendMessage`.
- **`server/src/sessions.ts`** — the start-run option/context types (`StartOpts`, `DriveCtx`)
  live here, not in `types.ts` (`types.ts`'s `note` is the unrelated `WorkflowStep` field). Add
  `attachments?: string[]` to `StartOpts` and `DriveCtx` — `StartOpts` is the source of truth for
  a run's launch options and is remembered on the run for restart.

## Security Considerations

Reference `docs/THREAT_MODEL.md`. Hangar is localhost-only with no auth layer; the attachment
endpoint follows the same posture as existing write endpoints.

- **Path traversal:** the client never controls the destination directory. The server derives
  the path from a fresh `randomUUID()` dir + `path.basename(name)`, so `../` or absolute names in
  `name` cannot escape `ATTACHMENTS_DIR`.
- **Size:** decoded byte length is capped at `MAX_ATTACHMENT_BYTES` (25 MB) → `400` past the cap;
  guards against a runaway base64 payload. The 40 MB parser limit sits above the decoded cap ×
  4/3 base64 overhead (≈ 33.3 MB) so an at-cap file parses before this check rejects oversized ones.
- **`attachments` path list** on `POST /api/runs*` accepts arbitrary absolute paths (the operator
  is trusted and already types paths into notes today). The agent's reads are auto-allowed by the
  existing permission model — no new trust boundary. Non-string/empty entries are filtered.
- **Data exposure:** saved files live under `.hangar/` (gitignored, `0700`) — treated as
  sensitive like run transcripts, per the Architecture "Security posture" note.

## Feature Flag

None — backend-only and additive. `attachments` is optional on existing endpoints and the new
route is unused until slice 002. `main` stays deployable.

## Verification Criteria

*Server has a test runner (`npm --prefix server test`, per `CLAUDE.md`); web does not. Add server
tests for this slice; gate with `typecheck` + `lint` + `format:check` + server tests.*

### Unit Tests
- [ ] `formatAttachments([])` → `""`; `formatAttachments(["/a", "/b"])` → block listing `- /a`
      and `- /b` with the header line.
- [ ] `saveAttachment("report.pdf", buf)` → writes under `ATTACHMENTS_DIR/<uuid>/report.pdf`;
      returned `path` exists on disk with the exact bytes and `size === buf.length`.
- [ ] `saveAttachment("../../etc/evil", buf)` → basename-sanitized to `evil`; saved path stays
      inside `ATTACHMENTS_DIR`.
- [ ] `buildPrompt` with `attachments` appends the block for both ticket and standalone prompts;
      omitting `attachments` produces the current output byte-for-byte (no regression).

### Integration Tests
- [ ] `POST /api/attachments` with `{ name, contentBase64 }` → `200 { path, name, size }`; GET-ing
      nothing, but the file is readable at `path`.
- [ ] `POST /api/attachments` missing `contentBase64` → `400`.
- [ ] `POST /api/attachments` with a payload decoding to > 25 MB → `400`.
- [ ] `POST /api/runs` with `attachments: ["/tmp/x"]` → run starts; the built prompt contains the
      `Attachments:` block (assert via the run's first prompt / persisted state).
- [ ] `POST /api/runs/:id/message` with `attachments` and empty `text` → not `400` (attachments
      satisfy the guard).

## Out of Scope

- Any UI (drop target, chips) — slices 002 and 003.
- Attachment **cleanup / retention** (removing files when a run is deleted or on a sweep). Files
  accumulate under `.hangar/attachments/`; a later slice can add cleanup tied to run deletion.
- A `hangar.config.json` field for the size cap or attachments dir — the 25 MB cap is a constant
  this slice. (If made configurable later, use `/config-field`.)
- Multipart uploads / streaming large files — base64 JSON with a 25 MB cap is sufficient for the
  local single-operator use case.
- De-duplicating identical uploads.

## Trunk Metadata
- **Type:** feat
- **Flag:** `none`
- **Complexity:** med
- **Issue:** — (filled by `/issues`)
- **Branch (post-/issues):** `feat/<issue-number>-attachment-storage-and-delivery`
