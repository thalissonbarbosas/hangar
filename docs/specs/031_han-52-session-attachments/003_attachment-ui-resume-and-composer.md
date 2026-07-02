# Feature: Attachment UI — resume message + follow-up composer

## Problem

Slices 001 + 002 make attachments work for the initial run note. The operator note asks for
attachments in **each** session note or input, so the two remaining compose surfaces still
lack them: the **resume message** (`SessionsView`) and the **follow-up prompt** (`RunPanel`
`Composer`). Both send through `POST /api/runs/:id/message`, which slice 001 already taught to
accept `attachments`.

## Solution

Reuse the `AttachmentBar` + `useAttachments` from slice 002 in both inputs, and thread the
attachment paths through `api.sendMessage` into the message endpoint. This depends on **slice
001** (endpoint + `sendMessage` attachments) and **slice 002** (the shared component).

## Technical Design

### API Changes

None server-side. Client wrapper only:

- **`web/src/api.ts`** — extend `sendMessage(runId, text, attachments?)` to include
  `attachments` in the POST body. Callers that don't attach pass nothing (unchanged behavior).

### Data Model

Client-only, per-input `useAttachments` state (same as slice 002). No persistence. The list is
reset after a successful send, alongside the existing draft/`resumeText` reset.

### Architecture

- **`web/src/components/SessionsView.tsx`** — render `<AttachmentBar>` beside the resume
  `AutoGrowTextarea`; pass its paths to `onResume`/`sendMessage`. Allow sending when there is
  **either** resume text or at least one attachment (today the button is disabled on empty
  text). Reset the list on send.
- **`web/src/components/RunPanel.tsx`** — in `Composer`, render `<AttachmentBar>` under the
  `AutoGrowTextarea`; include its paths in the `onSend`/`sendMessage` call. Enter-to-send stays;
  allow send when the draft is empty but attachments exist. Clear attachments when the draft
  clears after a successful send.
- No new component or CSS — reuses slice 002's `AttachmentBar`, `useAttachments`, and
  `.attachment-*` styles.

## Security Considerations

Reference `docs/THREAT_MODEL.md`. Identical posture to slice 002 — same upload path, same
same-origin CORS restriction, server-side size cap, no new rendering path or trust boundary.

## Feature Flag

None — user-ready on merge. Depends on slices 001 + 002. `main` stays deployable.

## Verification Criteria

*`web/` has no test runner (`CLAUDE.md`); gate with `typecheck` + `lint` + `format:check` +
`npm --prefix server test`, plus manual UI checks.*

### Type / Lint / Format Gates
- [ ] `npm run typecheck` exits 0 with `sendMessage` accepting optional `attachments` and both
      call sites updated.
- [ ] `npm run lint` and `npm run format:check` exit 0.
- [ ] `npm --prefix server test` exits 0 (server untouched by this slice).

### Manual UI Verification
- [ ] **Resume** (SessionsView → a finished/terminal-like session): drag a file onto the resume
      input → chip appears; Send/Cmd-Enter resumes and the agent's next turn shows the
      `Attachments:` block. Sending with only an attachment (empty text) works.
- [ ] **Composer** (RunPanel of a running/awaiting session): attach a file → send; the follow-up
      message the agent receives includes the attachment path. Attaching with an empty draft is
      allowed; after send, both draft and attachments clear.
- [ ] Both work in **terminal** and **classic** session themes.

## Out of Scope

- Attachment cleanup/retention (inherited from slice 001).
- Any surface beyond resume + composer (e.g. `HandoffModal`, `SkillRunner`, `AiWorkflow`) — the
  shared component can be dropped in later.
- Image previews / paste-to-attach.

## Trunk Metadata
- **Type:** feat
- **Flag:** `none`
- **Complexity:** low
- **Issue:** — (filled by `/issues`)
- **Branch (post-/issues):** `feat/<issue-number>-attachment-ui-resume-and-composer`
