# Feature: Session attachments (HAN-52)

## Problem

When an operator composes a session note or a follow-up prompt, the only way to give the
agent a file is to type or paste its absolute path from memory. There is no way to attach a
file directly. The operator wants to **drag a file onto the input** and have it become an
attachment — but the attachment is delivered as a **path to the file**, not embedded content,
because the agent runs locally with filesystem access and can read the file itself.

The wrinkle: Hangar is a **browser** app (Vite `:5180`, no Electron), and standard browsers do
**not** expose a dropped file's absolute OS path (`File.path` is Electron-only). So a dropped
file's bytes must be saved to a Hangar-managed location, and that saved absolute path becomes
the attachment. Attachments must be available in all three compose surfaces the HAN-47 rich
inputs already cover: the run **note** (`NoteModal`), the **resume message** (`SessionsView`),
and the **follow-up prompt** (`RunPanel` `Composer`).

## Solution

- On drop, read the file's bytes and upload them to a new `POST /api/attachments` endpoint,
  which saves each file under `.hangar/attachments/<id>/<name>` and returns its **absolute
  path**. That path is the attachment.
- Carry a list of attachment paths alongside the note (`POST /api/runs`) and the message
  (`POST /api/runs/:id/message`). Server-side, render them as a plain **`Attachments:` block**
  appended to the prompt so the agent reads the files itself (reads are auto-allowed). No file
  contents are embedded.
- A single reusable **`AttachmentBar`** component (drop target + chip list + remove) is dropped
  into all three compose surfaces, mirroring how `AutoGrowTextarea` was shared across them.

## Slices

| # | Slice | Type | Flag | Depends on | Complexity | Issue | Status |
|---|-------|------|------|------------|------------|-------|--------|
| 001 | [attachment-storage-and-delivery](001_attachment-storage-and-delivery.md) | feat | `none` | — | med | — | Not started |
| 002 | [attachment-ui-note-modal](002_attachment-ui-note-modal.md) | feat | `none` | 001 | med | — | Not started |
| 003 | [attachment-ui-resume-and-composer](003_attachment-ui-resume-and-composer.md) | feat | `none` | 001, 002 | low | — | Not started |

## Rollout

No feature flags. Each slice leaves `main` deployable:

- **001** is backend-only and purely additive — `attachments` is an optional field on two
  existing endpoints, plus one new endpoint. No user-visible change; nothing calls it yet.
- **002** delivers the first complete end-to-end flow (drag a file onto the run note → agent
  receives its path). Shippable on its own once 001 is merged.
- **003** reuses the 002 component in the remaining two inputs (resume + composer).

No flag is needed because every slice is user-ready on merge: an operator either sees no change
(001) or gets a fully working attachment flow for the surfaces that slice touches. There is no
half-built intermediate UI state exposed to the operator.
